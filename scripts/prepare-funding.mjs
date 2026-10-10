#!/usr/bin/env node
/**
 * SupplyRight - Sepolia funding plan (and, only after explicit confirmation, execution).
 *
 *   node scripts/prepare-funding.mjs              plan only: balances, gas estimates, ETH needed per wallet
 *   node scripts/prepare-funding.mjs --execute    plan, then ask for confirmation, then send each top-up with
 *                                                 `cast send --account <source keystore>` (cast asks for the
 *                                                 keystore password; it is never read by this script)
 *
 * Options:
 *   --from <alias>          source keystore alias (default: the deployer from config/wallets.sepolia.json)
 *   --gas-price-gwei <n>    planning gas price (default: max(10 x current max fee, 0.02 gwei))
 *   --json                  print the plan as JSON and exit (used by scripts/rehearse-sepolia-fork.sh)
 *
 * Gas per wallet comes from config/gas-profile.sepolia-fork.json, measured by scripts/rehearse-sepolia-fork.sh
 * on a fork of Sepolia, i.e. under the Glamsterdam gas schedule (EIP-8037 makes contract and storage creation
 * ~7x more expensive than on a plain local Anvil), plus a 10% margin. The provider additionally needs the
 * 0.010 ETH escrow; the buyer needs 0.001 ETH for the direct wallet-to-wallet transfer smoke test.
 * No transfer is sent without the confirmation prompt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/wallets.sepolia.json"), "utf8"));
const forkProfile = path.join(root, "config/gas-profile.sepolia-fork.json");
const profileFile = fs.existsSync(forkProfile) ? forkProfile : path.join(root, "config/gas-profile.anvil.json");
const gasProfile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
const glamsterdamProfile = profileFile === forkProfile;
const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[i + 1];
};
const execute = args.includes("--execute");

const GWEI = 10n ** 9n;
const ETH = 10n ** 18n;
const ESCROW = 10n ** 16n; // 0.010 ETH
const SMOKE_TRANSFER = 10n ** 15n; // 0.001 ETH, buyer -> verifier
const TRANSFER_GAS = 21_000n;
// Local Anvil deploy also grants the deployer three registrar/approver roles that Sepolia does not.
const LOCAL_ONLY_DEPLOY_GAS = glamsterdamProfile ? 0n : 3n * 51_333n;
// The fork's EIP-8037 parameters were measured ~1% below live Sepolia; plan with 10% headroom.
const withMargin = (gas) => (gas * 110n) / 100n;

let rpcId = 0;
async function rpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const fmt = (wei) => {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const frac = (v % ETH).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${v / ETH}${frac ? "." + frac : ""}`;
};
// Round a top-up up to the next 0.0005 ETH so the transfers are readable.
const roundUp = (wei) => {
  const step = 5n * 10n ** 14n;
  return ((wei + step - 1n) / step) * step;
};

async function main() {
  if (execute && args.includes("--json")) throw new Error("--execute and --json cannot be combined");
  const chainId = BigInt(await rpc("eth_chainId"));
  if (chainId !== BigInt(config.chainId)) throw new Error(`RPC is chain ${chainId}, expected ${config.chainId}`);
  const gasPrice = BigInt(await rpc("eth_gasPrice"));
  const priority = BigInt(await rpc("eth_maxPriorityFeePerGas").catch(() => "0x0"));
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  const currentMaxFee = 2n * baseFee + priority > gasPrice ? 2n * baseFee + priority : gasPrice;
  const planGwei = opt("--gas-price-gwei");
  if (planGwei !== undefined && (!Number.isFinite(Number(planGwei)) || Number(planGwei) <= 0 || Number(planGwei) > 1_000_000)) {
    throw new Error("--gas-price-gwei must be a positive finite number at most 1000000");
  }
  const planPrice = planGwei
    ? BigInt(Math.round(Number(planGwei) * 1e9))
    : (10n * currentMaxFee > GWEI / 50n ? 10n * currentMaxFee : GWEI / 50n);
  if (planPrice <= 0n) throw new Error("planning gas price must be at least 1 wei");

  const roles = [
    { key: "admin", gas: withMargin(BigInt(gasProfile.admin)), extra: 0n, why: "mint/activate/delivery" },
    { key: "buyer", gas: withMargin(BigInt(gasProfile.buyer)) + TRANSFER_GAS, extra: SMOKE_TRANSFER, why: "request, claim, ETH smoke transfer" },
    { key: "provider", gas: withMargin(BigInt(gasProfile.provider)), extra: ESCROW, why: "0.010 ETH escrow + fund tx" },
    { key: "verifier", gas: withMargin(BigInt(gasProfile.verifier)), extra: 0n, why: "approve + settle" },
  ];
  for (const r of roles) {
    const w = config.wallets[r.key];
    if (!w.address) throw new Error(`config has no address for ${r.key}; run scripts/setup-supplyright-wallets.sh`);
    r.address = w.address;
    r.alias = w.keystoreAlias;
    r.balance = BigInt(await rpc("eth_getBalance", [w.address, "latest"]));
    r.need = r.gas * planPrice + r.extra;
    r.topUp = r.balance >= r.need ? 0n : roundUp(r.need - r.balance);
  }
  const configuredAddresses = [config.deployer.address, ...roles.map((r) => r.address)];
  if (!configuredAddresses.every((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
      || new Set(configuredAddresses.map((a) => a.toLowerCase())).size !== configuredAddresses.length) {
    throw new Error("deployer and role wallet addresses must be valid and distinct; nothing sent");
  }

  const sourceAlias = opt("--from") || config.deployer.keystoreAlias;
  const sourceAddress = sourceAlias === config.deployer.keystoreAlias ? config.deployer.address : opt("--from-address");
  if (!sourceAddress) throw new Error("--from <alias> needs --from-address <its public address>");
  if (!/^0x[0-9a-fA-F]{40}$/.test(sourceAddress)) throw new Error("source address is not a valid Ethereum address");
  if (roles.some((r) => r.address.toLowerCase() === sourceAddress.toLowerCase())) {
    throw new Error("funding source must be separate from the four destination role wallets");
  }
  const deployerBalance = BigInt(await rpc("eth_getBalance", [config.deployer.address, "latest"]));
  const deployGas = withMargin(BigInt(gasProfile.deployer) - LOCAL_ONLY_DEPLOY_GAS);
  const deploymentFile = path.join(root, "contracts/deployments/11155111.json");
  const recordedContracts = fs.existsSync(deploymentFile) ? JSON.parse(fs.readFileSync(deploymentFile, "utf8")) : null;
  const contractKeys = ["supplyRightNFT", "protectionNFT", "recoveryClaimNFT", "vault", "claimManager"];
  const contractAddresses = contractKeys.map((k) => config.contracts?.[k] || recordedContracts?.[k]);
  const deployed = contractAddresses.length === 5 && contractAddresses.every((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    && (await Promise.all(contractAddresses.map((a) => rpc("eth_getCode", [a, "latest"])))).every((code) => code !== "0x");
  const deployerNeed = deployed ? 0n : deployGas * planPrice;
  const transfers = roles.filter((r) => r.topUp > 0n);
  const transferGasCost = BigInt(transfers.length) * TRANSFER_GAS * planPrice;
  const sourceBalance =
    sourceAddress.toLowerCase() === config.deployer.address.toLowerCase()
      ? deployerBalance
      : BigInt(await rpc("eth_getBalance", [sourceAddress, "latest"]));
  const totalTopUps = transfers.reduce((s, r) => s + r.topUp, 0n);
  const sourceIsDeployer = sourceAddress.toLowerCase() === config.deployer.address.toLowerCase();
  const sourceNeed = totalTopUps + transferGasCost + (sourceIsDeployer ? deployerNeed : 0n);

  if (args.includes("--json")) {
    const plan = {
      planGasPriceWei: planPrice.toString(),
      deployer: { address: config.deployer.address, deployGasCostWei: deployerNeed.toString() },
      roles: roles.map((r) => ({ key: r.key, address: r.address, needWei: r.need.toString(), topUpWei: r.topUp.toString() })),
    };
    console.log(JSON.stringify(plan));
    return;
  }

  console.log("SupplyRight - Sepolia funding plan");
  console.log(
    glamsterdamProfile
      ? `gas profile: ${path.relative(root, profileFile)} (measured on a Sepolia fork, Glamsterdam rules) + 10%`
      : `WARNING: gas profile ${path.relative(root, profileFile)} was measured on plain Anvil and UNDERESTIMATES ` +
          "Sepolia since Glamsterdam; run scripts/rehearse-sepolia-fork.sh first",
  );
  console.log(`RPC ${rpcUrl.replace(/(https?:\/\/[^/]+).*/, "$1/...")} · chain ${chainId} · block ${BigInt(block.number)}`);
  console.log(
    `gas price now ${Number(gasPrice) / 1e9} gwei (base fee ${Number(baseFee) / 1e9} gwei); ` +
      `planning price ${Number(planPrice) / 1e9} gwei`,
  );
  console.log("");
  console.log("Role      Address                                     Balance        Gas units  Gas@plan       Extra   Needed     Top-up");
  for (const r of roles) {
    console.log(
      `${r.key.padEnd(9)} ${r.address} ${fmt(r.balance).padEnd(14)} ${String(r.gas).padStart(9)}  ${fmt(r.gas * planPrice).padEnd(13)} ${fmt(r.extra).padEnd(7)} ${fmt(r.need).padEnd(10)} ${fmt(r.topUp)}`,
    );
  }
  console.log(
    `deployer  ${config.deployer.address} ${fmt(deployerBalance).padEnd(14)} ${String(deployed ? 0n : deployGas).padStart(9)}  ${fmt(deployerNeed).padEnd(13)} ${deployed ? "(contracts already deployed)" : "deploy + 11 role grants"}`,
  );
  console.log("");
  console.log(`At today's gas price the whole run costs about ${fmt((deployGas + roles.reduce((s, r) => s + r.gas, 0n)) * currentMaxFee)} ETH in gas; the plan uses the higher planning price as a buffer.`);
  console.log("");
  console.log("Planned transfers:");
  if (transfers.length === 0) console.log("  none - every role wallet already holds enough ETH");
  for (const r of transfers) {
    console.log(`  ${sourceAddress} (${sourceAlias}) -> ${r.address} (${r.alias})  ${fmt(r.topUp)} ETH  [${r.why}]  gas 21000 (~${fmt(TRANSFER_GAS * planPrice)} ETH)`);
  }
  console.log("");
  console.log(`Source ${sourceAlias} needs ${fmt(sourceNeed)} ETH (top-ups ${fmt(totalTopUps)} + transfer gas ${fmt(transferGasCost)}${sourceIsDeployer ? ` + deployment ${fmt(deployerNeed)}` : ""}); it holds ${fmt(sourceBalance)} ETH.`);
  const shortfall = sourceNeed > sourceBalance ? sourceNeed - sourceBalance : 0n;
  if (shortfall > 0n) {
    console.log(`INSUFFICIENT: send at least ${fmt(shortfall)} Sepolia ETH to ${sourceAddress} first (faucet or another wallet).`);
  } else {
    console.log("Source balance is sufficient.");
  }

  if (!execute) {
    console.log("\nPlan only - nothing was sent. Re-run with --execute to send these transfers after confirming.");
    return;
  }
  if (shortfall > 0n) throw new Error("source balance insufficient; nothing sent");
  if (transfers.length === 0) return;

  // A --from-address is a claim about the alias, not proof of it. Unlock the source
  // interactively and compare before displaying the final confirmation or spending.
  const cast = process.env.CAST || "cast";
  const keystoreDir = process.env.FOUNDRY_KEYSTORE_DIR || path.join(os.homedir(), ".foundry", "keystores");
  const sourceKeystore = path.join(keystoreDir, sourceAlias);
  if (!fs.existsSync(sourceKeystore)) throw new Error(`source keystore is missing: ${sourceKeystore}`);
  console.log(`\nVerify funding source ${sourceAlias} (hidden keystore password prompt):`);
  const addressResult = spawnSync(cast, ["wallet", "address", "--keystore", sourceKeystore], {
    stdio: ["inherit", "pipe", "inherit"], encoding: "utf8",
  });
  if (addressResult.status !== 0 || addressResult.stdout.trim().toLowerCase() !== sourceAddress.toLowerCase()) {
    throw new Error(`keystore ${sourceAlias} does not resolve to planned source ${sourceAddress}; nothing sent`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nSend the ${transfers.length} transfer(s) above from ${sourceAddress}? Type "yes" to confirm: `);
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("Not confirmed - nothing sent.");
    return;
  }
  for (const r of transfers) {
    console.log(`\n-> ${fmt(r.topUp)} ETH to ${r.key} ${r.address} (cast asks for the ${sourceAlias} keystore password)`);
    const res = spawnSync(
      cast,
      ["send", r.address, "--value", r.topUp.toString(), "--keystore", sourceKeystore, "--rpc-url", rpcUrl, "--json"],
      { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
    );
    if (res.status !== 0) throw new Error(`transfer to ${r.key} failed; stopping (later transfers not sent)`);
    const receipt = JSON.parse(res.stdout);
    const ok = receipt.status === "0x1" || receipt.status === 1 || receipt.status === "1";
    console.log(`   tx ${receipt.transactionHash} · block ${BigInt(receipt.blockNumber)} · status ${ok ? "success" : "FAILED"}`);
    console.log(`   ${config.explorer}/tx/${receipt.transactionHash}`);
    if (!ok) throw new Error("transfer reverted; stopping");
  }
  console.log("\nBalances after funding:");
  for (const r of roles) {
    console.log(`  ${r.key.padEnd(9)} ${r.address} ${fmt(BigInt(await rpc("eth_getBalance", [r.address, "latest"])))} ETH`);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});

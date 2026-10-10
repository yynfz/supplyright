#!/usr/bin/env node
/**
 * scripts/prepare-funding.mjs
 *
 * Balance inspection, gas estimation, and funding preparation script for:
 * - Deployer: 0x959a7CDa30042C26deAAE4Cf27Cc319dFE2CB5B8
 * - 4 Wallets: buyer, provider, verifier, admin
 *
 * Uses built-in node fetch with standard JSON-RPC 2.0 (Zero external dependencies).
 * Checks balances, calculates required Sepolia ETH (including provider 0.010 ETH escrow),
 * evaluates sufficiency, and displays complete summary tables.
 * Stops BEFORE executing any transfer and requests explicit approval.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "../config/wallets.sepolia.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

let rpcId = 0;
async function rpcCall(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

function weiToEth(weiBigInt) {
  const str = weiBigInt.toString().padStart(19, "0");
  const whole = str.slice(0, -18);
  const frac = str.slice(-18).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

function ethToWei(ethStr) {
  const [whole, frac = ""] = ethStr.split(".");
  const paddedFrac = frac.padEnd(18, "0").slice(0, 18);
  return BigInt(whole + paddedFrac);
}

const deployerAddress = config.deployer.address;
const roles = [
  { key: "admin", name: "supplyright-admin", address: config.wallets.admin.address, requiredGasEth: "0.005", escrowEth: "0.000" },
  { key: "buyer", name: "supplyright-buyer", address: config.wallets.buyer.address, requiredGasEth: "0.005", escrowEth: "0.000" },
  { key: "provider", name: "supplyright-provider", address: config.wallets.provider.address, requiredGasEth: "0.005", escrowEth: "0.010" },
  { key: "verifier", name: "supplyright-verifier", address: config.wallets.verifier.address, requiredGasEth: "0.005", escrowEth: "0.000" },
];

async function main() {
  console.log("================================================================================");
  console.log(" SupplyRight: Sepolia Funding Preparation & Balance Check");
  console.log(` Network: Ethereum Sepolia (Chain ID ${config.chainId})`);
  console.log(` RPC Endpoint: ${rpcUrl}`);
  console.log("================================================================================\n");

  let gasPriceWei = 1000000000n; // fallback 1 gwei
  try {
    const gpHex = await rpcCall("eth_gasPrice", []);
    gasPriceWei = BigInt(gpHex);
  } catch (err) {
    console.warn("Could not fetch current gas price from RPC, using 1 gwei fallback:", err.message);
  }

  // 1. Fetch balances
  let deployerBalWei = 0n;
  try {
    const balHex = await rpcCall("eth_getBalance", [deployerAddress, "latest"]);
    deployerBalWei = BigInt(balHex);
  } catch (e) {
    console.warn("Could not read deployer balance from RPC:", e.message);
  }

  console.log(`Deployer Account: ${deployerAddress}`);
  console.log(`Deployer Balance: ${weiToEth(deployerBalWei)} Sepolia ETH\n`);

  console.log("Role Wallets Balance and Requirements:");
  console.log("--------------------------------------------------------------------------------");
  console.log(
    "Role".padEnd(23) +
    "Address".padEnd(44) +
    "Current ETH".padEnd(16) +
    "Gas Req".padEnd(10) +
    "Escrow Req".padEnd(12) +
    "Total Needed"
  );
  console.log("--------------------------------------------------------------------------------");

  let totalFundingNeededWei = 0n;
  const fundingTransfers = [];

  for (const r of roles) {
    let balWei = 0n;
    try {
      const balHex = await rpcCall("eth_getBalance", [r.address, "latest"]);
      balWei = BigInt(balHex);
    } catch (e) {
      // network/rpc error fallback
    }

    const gasWei = ethToWei(r.requiredGasEth);
    const escrowWei = ethToWei(r.escrowEth);
    const targetWei = gasWei + escrowWei;

    let deficitWei = targetWei > balWei ? targetWei - balWei : 0n;
    totalFundingNeededWei += deficitWei;

    console.log(
      r.name.padEnd(23) +
      r.address.padEnd(44) +
      weiToEth(balWei).slice(0, 10).padEnd(16) +
      (r.requiredGasEth + " ETH").padEnd(10) +
      (r.escrowEth + " ETH").padEnd(12) +
      weiToEth(deficitWei).slice(0, 10) + " ETH"
    );

    if (deficitWei > 0n) {
      fundingTransfers.push({
        source: deployerAddress,
        destination: r.address,
        role: r.name,
        amountWei: deficitWei,
        amountEth: weiToEth(deficitWei),
        estimatedGas: 21000n,
        estimatedGasCostWei: 21000n * gasPriceWei,
      });
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(`Total Funding Required across 4 wallets: ${weiToEth(totalFundingNeededWei)} Sepolia ETH\n`);

  console.log("Planned Transfers from Deployer:");
  console.log("--------------------------------------------------------------------------------");
  for (const t of fundingTransfers) {
    console.log(`- Destination : ${t.destination} (${t.role})`);
    console.log(`  Source      : ${t.source}`);
    console.log(`  ETH Amount  : ${t.amountEth} ETH`);
    console.log(`  Est. Gas    : ${t.estimatedGas} gas (~${weiToEth(t.estimatedGasCostWei)} ETH)`);
    console.log(`  Total Req   : ${weiToEth(t.amountWei + t.estimatedGasCostWei)} ETH\n`);
  }

  const isSufficient = deployerBalWei >= totalFundingNeededWei;
  console.log(`Deployer Balance Sufficiency: ${isSufficient ? "SUFFICIENT" : "INSUFFICIENT"}`);
  if (!isSufficient) {
    console.log(`Deficit: ${weiToEth(totalFundingNeededWei - deployerBalWei)} Sepolia ETH needed on deployer wallet.`);
  }

  console.log("\n================================================================================");
  console.log(" [STOP] SAFETY GUARD:");
  console.log(" As per security requirements, NO on-chain funding transaction is executed automatically.");
  console.log(" User approval and sufficient Sepolia ETH balance are required before broadcasting.");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});


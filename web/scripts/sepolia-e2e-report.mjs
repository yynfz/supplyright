#!/usr/bin/env node
/**
 * Verifies the recorded Sepolia transactions ONCHAIN and writes docs/SEPOLIA-E2E-RESULTS.md.
 *
 * Sources of transaction hashes (written only by real broadcasts):
 *   contracts/broadcast/{Deploy,SetupRoles,RunSepoliaE2E}.s.sol/11155111/run-*.json   (forge)
 *   contracts/deployments/11155111-transfers.json                                    (scripts/run-sepolia-e2e.sh smoke)
 * For every hash the receipt is fetched from the RPC and its status, block, gas and decoded events are reported;
 * nothing is taken from the local files without being confirmed by the chain. Final balances, NFT ownership,
 * escrow and claim state are read live.
 *
 * Env: SEPOLIA_RPC_URL, E2E_RUN_ID (SEPOLIA-E2E-001), REPORT_OUT (default docs/SEPOLIA-E2E-RESULTS.md),
 *      REPORT_LABEL (heading suffix, e.g. "fork rehearsal")
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, decodeEventLog, formatEther, http, keccak256, toBytes } from "viem";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const runId = process.env.E2E_RUN_ID || "SEPOLIA-E2E-001";
const outFile = path.resolve(root, process.env.REPORT_OUT || "docs/SEPOLIA-E2E-RESULTS.md");
const label = process.env.REPORT_LABEL || "";
const config = JSON.parse(fs.readFileSync(path.join(root, "config/wallets.sepolia.json"), "utf8"));
const explorer = config.explorer;
const CHAIN = 11155111;

const abiOf = (name) => JSON.parse(fs.readFileSync(path.join(root, `contracts/out/${name}.sol/${name}.json`), "utf8")).abi;
const abis = {
  supplyRightNFT: abiOf("SupplyRightNFT"),
  protectionNFT: abiOf("ProtectionNFT"),
  recoveryClaimNFT: abiOf("RecoveryClaimNFT"),
  vault: abiOf("SupplyProtectionVault"),
  claimManager: abiOf("SupplyClaimManager"),
};
const client = createPublicClient({ transport: http(rpcUrl) });

const roles = {
  [config.deployer.address.toLowerCase()]: "deployer",
  ...Object.fromEntries(Object.entries(config.wallets).map(([k, w]) => [String(w.address).toLowerCase(), k])),
};
const roleOf = (a) => roles[String(a).toLowerCase()] ?? String(a);
const eth = (wei) => `${formatEther(wei)} ETH`;
const link = (kind, v) => `[${kind === "tx" ? `${v.slice(0, 10)}…${v.slice(-6)}` : v}](${explorer}/${kind}/${v})`;

const STEP = {
  mintSupplyRight: "1 · admin mints SupplyRight NFT to buyer",
  activate: "1 · admin records supplier acknowledgement",
  recordDelivery: "1 · admin records delivery note (10/50 MT)",
  requestProtection: "2 · buyer requests protection",
  fundAndApproveProtection: "3 · provider sends 0.010 ETH escrow + activates",
  submitClaim: "4 · buyer files claim",
  approveClaim: "5 · verifier approves claim",
  settleClaim: "6 · atomic settlement",
};

function recordedTransactions() {
  const out = [];
  for (const [script, group] of [["Deploy.s.sol", "deploy"], ["SetupRoles.s.sol", "roles"], ["RunSepoliaE2E.s.sol", "e2e"]]) {
    const dir = path.join(root, `contracts/broadcast/${script}/${CHAIN}`);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort()) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const t of run.transactions) {
        if (!t.hash) continue;
        const fn = (t.function ?? "").split("(")[0];
        const name = t.transactionType === "CREATE" ? `create ${t.contractName}` : `${t.contractName ? t.contractName + "." : ""}${fn}`;
        out.push({ group, hash: t.hash, label: group === "e2e" ? STEP[fn] ?? fn : name });
      }
    }
  }
  const transfers = path.join(root, `contracts/deployments/${CHAIN}-transfers.json`);
  if (fs.existsSync(transfers)) {
    for (const t of JSON.parse(fs.readFileSync(transfers, "utf8"))) out.push({ group: "transfer", hash: t.hash, label: t.label });
  }
  const seen = new Set();
  return out.filter((t) => !seen.has(t.hash) && seen.add(t.hash));
}

function decodeLogs(logs, contracts) {
  const byAddress = Object.fromEntries(Object.entries(contracts).map(([k, a]) => [String(a).toLowerCase(), k]));
  return logs.map((log) => {
    const key = byAddress[log.address.toLowerCase()];
    // Glamsterdam (EIP-7708) emits a log from this system address for every native ETH transfer.
    if (log.address.toLowerCase() === "0xfffffffffffffffffffffffffffffffffffffffe") return "ETH transfer log";
    if (!key) return `log@${log.address}`;
    try {
      const ev = decodeEventLog({ abi: abis[key], data: log.data, topics: log.topics });
      return `${key}.${ev.eventName}`;
    } catch {
      return `${key}.?`;
    }
  });
}

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== CHAIN) throw new Error(`RPC chain ${chainId} is not Sepolia`);
  const contracts = config.contracts;
  const problems = [];
  const warnings = []; // reverted attempts that a later successful transaction superseded stay visible here
  if (!contracts?.vault) problems.push("contracts are not deployed (config/wallets.sepolia.json has no addresses)");

  const txs = recordedTransactions();
  const rows = [];
  for (const t of txs) {
    const r = await client.getTransactionReceipt({ hash: t.hash }).catch(() => null);
    if (!r) {
      problems.push(`no receipt onchain for ${t.hash} (${t.label})`);
      rows.push({ ...t, status: "NOT FOUND" });
      continue;
    }
    if (r.status !== "success") warnings.push(`${t.hash} (${t.label}) reverted onchain`);
    rows.push({
      ...t,
      status: r.status,
      block: r.blockNumber,
      from: roleOf(r.from),
      gasUsed: r.gasUsed,
      fee: r.gasUsed * r.effectiveGasPrice,
      events: contracts?.vault ? decodeLogs(r.logs, contracts) : [],
      logs: r.logs,
    });
  }

  for (const step of new Set(rows.map((r) => r.label))) {
    if (!rows.some((r) => r.label === step && r.status === "success")) problems.push(`"${step}" has no successful transaction`);
  }

  let state = null;
  if (contracts?.vault && (await client.getCode({ address: contracts.vault }))) {
    const read = (key, functionName, args = []) => client.readContract({ address: contracts[key], abi: abis[key], functionName, args });
    const wallets = [["deployer", config.deployer.address], ...Object.entries(config.wallets).map(([k, w]) => [k, w.address])];
    const holdings = [];
    for (const [role, address] of wallets) {
      holdings.push({
        role,
        address,
        balance: await client.getBalance({ address }),
        rights: await read("supplyRightNFT", "balanceOf", [address]),
        protections: await read("protectionNFT", "balanceOf", [address]),
        recoveries: await read("recoveryClaimNFT", "balanceOf", [address]),
      });
    }
    const vault = {
      balance: await client.getBalance({ address: contracts.vault }),
      free: await read("vault", "totalFreeCollateral"),
      locked: await read("vault", "totalLockedCollateral"),
      paid: await read("vault", "totalPaidOut"),
    };
    const rightId = await read("supplyRightNFT", "tokenIdByPoRef", [keccak256(toBytes(`SupplyRight/${runId}/PO`))]);
    let e2e = null;
    if (rightId > 0n) {
      const sr = await read("supplyRightNFT", "getSupplyRight", [rightId]);
      const owner = await read("supplyRightNFT", "ownerOf", [rightId]);
      const statusName = await read("supplyRightNFT", "statusName", [sr.status]);
      e2e = { rightId, owner, statusName, sr };
      if (sr.protectionId > 0n) {
        e2e.protection = await read("vault", "getProtection", [sr.protectionId]);
        e2e.protectionOwner = await read("protectionNFT", "ownerOf", [sr.protectionId]);
      }
      const ids = await read("claimManager", "claimsOfSupplyRight", [rightId]);
      if (ids.length) {
        e2e.claimId = ids[ids.length - 1];
        e2e.claim = await read("claimManager", "getClaim", [e2e.claimId]);
        if (e2e.claim.status === 5) e2e.recoveryOwner = await read("recoveryClaimNFT", "ownerOf", [e2e.claim.recoveryTokenId]);
      }
    }
    state = { holdings, vault, e2e };
    if (vault.balance < vault.free + vault.locked) problems.push("vault ETH balance is below its accounted collateral");
  }

  // Settlement evidence from the settle receipt itself.
  const settle = rows.find((r) => r.label === STEP.settleClaim && r.status === "success");
  let payout = null;
  if (settle) {
    for (const log of settle.logs) {
      if (log.address.toLowerCase() !== String(contracts.vault).toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: abis.vault, data: log.data, topics: log.topics });
        if (ev.eventName === "PayoutExecuted") payout = ev.args;
      } catch {}
    }
  }
  const claim = state?.e2e?.claim;
  const settled = claim?.status === 5;
  if (settled) {
    if (roleOf(state.e2e.recoveryOwner) !== "provider") problems.push("Recovery Claim NFT is not owned by the provider wallet");
    if (roleOf(state.e2e.owner) !== "buyer") problems.push("SupplyRight NFT is not owned by the buyer wallet");
    if (!payout || roleOf(payout.beneficiary) !== "buyer" || payout.amount !== claim.payoutAmount) {
      problems.push("settlement receipt does not show the payout to the buyer");
    }
  }
  const verdict = problems.length ? "FAIL" : settled ? "PASS" : "INCOMPLETE";

  const md = [];
  md.push(`# SupplyRight Sepolia E2E results${label ? ` (${label})` : ""}`, "");
  md.push(`Generated ${new Date().toISOString()} by \`web/scripts/sepolia-e2e-report.mjs\` from onchain receipts and live reads.`);
  md.push(`Chain ${chainId} · run id \`${runId}\` · verdict **${verdict}**`, "");
  if (problems.length) md.push("Problems:", "", ...problems.map((p) => `- ${p}`), "");
  if (warnings.length) md.push("Reverted attempts (superseded by a later successful transaction):", "", ...warnings.map((w) => `- ${w}`), "");
  if (state) {
    md.push("## Wallets", "", "| Role | Public address | ETH balance | SupplyRight NFT | Protection NFT | Recovery Claim NFT |", "| --- | --- | --- | --- | --- | --- |");
    for (const h of state.holdings) {
      md.push(`| ${h.role} | ${link("address", h.address)} | ${eth(h.balance)} | ${h.rights} | ${h.protections} | ${h.recoveries} |`);
    }
    md.push("", "## Escrow (SupplyProtectionVault)", "");
    md.push(`- vault ${link("address", contracts.vault)}: balance ${eth(state.vault.balance)} · free ${eth(state.vault.free)} · locked ${eth(state.vault.locked)} · paid out ${eth(state.vault.paid)}`, "");
    if (state.e2e) {
      const e = state.e2e;
      md.push("## E2E case", "");
      md.push(`- SupplyRight NFT #${e.rightId} owner ${roleOf(e.owner)} · status ${e.statusName} · delivered ${Number(e.sr.deliveredQuantity) / 1000} of ${Number(e.sr.orderedQuantity) / 1000} MT`);
      if (e.protection) md.push(`- Protection NFT #${e.sr.protectionId} owner ${roleOf(e.protectionOwner)} · coverage ${eth(e.protection.coverageAmount)} · locked ${eth(e.protection.lockedAmount)} · paid ${eth(e.protection.paidAmount)}`);
      if (claim) {
        const names = ["None", "Submitted", "Approved", "Rejected", "Disputed", "Settled", "Withdrawn"];
        md.push(`- Claim #${e.claimId} status ${names[claim.status]} · approved loss ${eth(claim.approvedLoss)} · payout ${eth(claim.payoutAmount)}`);
      }
      if (settled) {
        md.push(`- Recovery Claim NFT #${claim.recoveryTokenId} owner ${roleOf(e.recoveryOwner)}`);
        if (payout) md.push(`- Settlement receipt: PayoutExecuted ${eth(payout.amount)} to ${roleOf(payout.beneficiary)}, ${eth(payout.remainingLocked)} stays locked`);
        const matches = claim.payoutAmount === 8_000_000_000_000_000n && e.protection?.lockedAmount === 2_000_000_000_000_000n;
        md.push(`- Scenario check (0.008 ETH to buyer, 0.002 ETH remaining): ${matches ? "matches the contract outcome" : "the contract outcome differs; contract rules apply"}`);
      }
      md.push("");
    }
  }
  md.push("## Transactions (receipts fetched from the chain)", "", "| Step | Signer | Tx | Block | Status | Gas used | Fee | Events |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    md.push(`| ${r.label} | ${r.from ?? "-"} | ${link("tx", r.hash)} | ${r.block ?? "-"} | ${r.status} | ${r.gasUsed ?? "-"} | ${r.fee !== undefined ? eth(r.fee) : "-"} | ${(r.events ?? []).join(", ")} |`);
  }
  if (!rows.length) md.push("| _no broadcast transactions recorded yet_ | | | | | | | |");
  md.push("");
  fs.writeFileSync(outFile, md.join("\n"));
  console.log(`verdict ${verdict}; ${rows.length} transactions checked; wrote ${path.relative(root, outFile)}`);
  for (const p of problems) console.log(`  problem: ${p}`);
  if (verdict === "FAIL") process.exit(1);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});

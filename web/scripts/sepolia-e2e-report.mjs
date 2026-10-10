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
import { createPublicClient, decodeEventLog, decodeFunctionData, formatEther, http, keccak256, toBytes } from "viem";
import { SCENARIO_STEPS, explorerReference, isLocalReport, verifyScenarioReceipts, verifySmokeTransfer } from "./sepolia-e2e-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const runId = process.env.E2E_RUN_ID || "SEPOLIA-E2E-001";
const outFile = path.resolve(root, process.env.REPORT_OUT || "docs/SEPOLIA-E2E-RESULTS.md");
const label = process.env.REPORT_LABEL || "";
const config = JSON.parse(fs.readFileSync(path.join(root, "config/wallets.sepolia.json"), "utf8"));
const explorer = config.explorer;
const localReport = isLocalReport(rpcUrl, label);
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
const link = (kind, v) => explorerReference(kind, v, explorer, localReport);

const STEP = Object.fromEntries(SCENARIO_STEPS.map(({ key, label }) => [key, label]));

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
    for (const t of JSON.parse(fs.readFileSync(transfers, "utf8"))) {
      out.push({ group: "transfer", runId: t.runId, hash: t.hash, label: `${t.label} [${t.runId ?? "unscoped"}]` });
    }
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
  const warnings = [];
  if (!contracts?.vault) problems.push("contracts are not deployed (config/wallets.sepolia.json has no addresses)");

  const txs = recordedTransactions();
  const rows = [];
  for (const t of txs) {
    const r = await client.getTransactionReceipt({ hash: t.hash }).catch(() => null);
    if (!r) {
      warnings.push(`no receipt onchain for recorded ${t.hash} (${t.label})`);
      rows.push({ ...t, status: "NOT FOUND" });
      continue;
    }
    const transaction = await client.getTransaction({ hash: t.hash }).catch(() => null);
    if (!transaction) warnings.push(`no transaction details onchain for ${t.hash} (${t.label})`);
    const contractKey = transaction?.to && Object.entries(contracts ?? {}).find(([, address]) => address && address.toLowerCase() === transaction.to.toLowerCase())?.[0];
    let decoded = null;
    if (transaction && contractKey && abis[contractKey]) {
      try { decoded = decodeFunctionData({ abi: abis[contractKey], data: transaction.input }); } catch {}
    }
    if (r.status !== "success") warnings.push(`${t.hash} (${t.label}) reverted onchain`);
    rows.push({
      ...t,
      status: r.status,
      block: r.blockNumber,
      transactionIndex: r.transactionIndex,
      from: roleOf(r.from),
      fromAddress: r.from,
      to: transaction?.to ?? r.to,
      input: transaction?.input,
      value: transaction?.value,
      functionName: decoded?.functionName,
      args: decoded?.args,
      gasUsed: r.gasUsed,
      fee: r.gasUsed * r.effectiveGasPrice,
      events: contracts?.vault ? decodeLogs(r.logs, contracts) : [],
      logs: r.logs,
    });
  }

  let state = null;
  const contractCode = Object.fromEntries(await Promise.all(Object.keys(abis).map(async (key) => [
    key,
    contracts?.[key] ? !!(await client.getCode({ address: contracts[key] })) : false,
  ])));
  for (const [key, present] of Object.entries(contractCode)) {
    if (!present) problems.push(`${key} has no contract code at the configured address`);
  }
  if (Object.values(contractCode).every(Boolean)) {
    const read = (key, functionName, args = []) => client.readContract({ address: contracts[key], abi: abis[key], functionName, args });
    const defaultAdmin = `0x${"00".repeat(32)}`;
    const role = (name) => keccak256(toBytes(name));
    for (const key of Object.keys(abis)) {
      if (!(await read(key, "hasRole", [defaultAdmin, config.wallets.admin.address]))) {
        problems.push(`admin wallet lacks DEFAULT_ADMIN_ROLE on ${key}`);
      }
    }
    for (const [key, roleName, wallet] of [
      ["supplyRightNFT", "REGISTRAR_ROLE", "admin"],
      ["supplyRightNFT", "BUYER_ROLE", "buyer"],
      ["vault", "PROVIDER_ROLE", "provider"],
      ["claimManager", "VERIFIER_ROLE", "verifier"],
    ]) {
      if (!(await read(key, "hasRole", [role(roleName), config.wallets[wallet].address]))) {
        problems.push(`${wallet} wallet lacks ${roleName} on ${key}`);
      }
    }
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
        e2e.requestId = e2e.protection.requestId;
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

  const context = {
    runId,
    contracts: contracts ?? {},
    wallets: Object.fromEntries(Object.entries(config.wallets).map(([key, wallet]) => [key, wallet.address])),
    rightId: state?.e2e?.rightId,
    requestId: state?.e2e?.requestId,
    protectionId: state?.e2e?.sr.protectionId,
    claimId: state?.e2e?.claimId,
  };
  const evidence = verifyScenarioReceipts(rows, context);
  problems.push(...evidence.problems);
  const smoke = verifySmokeTransfer(rows, runId, config.wallets.buyer.address, config.wallets.verifier.address);
  if (!smoke) problems.push("no confirmed 0.001 ETH buyer → verifier smoke transfer receipt");
  const funding = evidence.selected.find((row) => row.step === "fundAndApproveProtection");
  if (funding && funding.value !== 10_000_000_000_000_000n) {
    warnings.push(`provider sent ${eth(funding.value)} in the activation transaction; 0.010 ETH coverage used existing free collateral for the remainder`);
  }

  // Settlement evidence from the settle receipt itself.
  const settle = evidence.selected.find((row) => row.step === "settleClaim");
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
    if (!payout || roleOf(payout.beneficiary) !== "buyer" || payout.amount !== claim.payoutAmount || payout.protectionId !== state.e2e.sr.protectionId) {
      problems.push("settlement receipt does not show the payout to the buyer");
    }
  }
  if (!settled) problems.push(`claim for run ${runId} is not settled onchain`);
  const verdict = problems.length ? "FAIL" : settled ? "PASS" : "INCOMPLETE";

  const md = [];
  md.push(`# SupplyRight Sepolia E2E results${label ? ` (${label})` : ""}`, "");
  md.push(`Generated ${new Date().toISOString()} by \`web/scripts/sepolia-e2e-report.mjs\` from onchain receipts and live reads.`);
  md.push(`Chain ${chainId} · run id \`${runId}\` · verdict **${verdict}**`, "");
  if (localReport) md.push("**Local RPC or fork report:** hashes and balances were verified against the configured RPC. Public Sepolia explorer links are omitted.", "");
  if (problems.length) md.push("Problems:", "", ...problems.map((p) => `- ${p}`), "");
  if (warnings.length) md.push("Other recorded transaction warnings:", "", ...warnings.map((w) => `- ${w}`), "");
  md.push(`Confirmed receipts tied to this run: ${evidence.selected.length}/${SCENARIO_STEPS.length} scenario actions${smoke ? "; direct transfer confirmed" : "; direct transfer missing"}.`, "");
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
        if (funding) md.push(`- Provider activation sent ${eth(funding.value)} from the connected provider wallet to the vault.`);
        if (payout) md.push(`- Settlement receipt: PayoutExecuted ${eth(payout.amount)} to ${roleOf(payout.beneficiary)}, ${eth(payout.remainingLocked)} stays locked`);
        const matches = claim.payoutAmount === 8_000_000_000_000_000n && e.protection?.lockedAmount === 2_000_000_000_000_000n;
        md.push(`- Scenario check (0.008 ETH to buyer, 0.002 ETH remaining): ${matches ? "matches the contract outcome" : "the contract outcome differs; contract rules apply"}`);
      }
      md.push("");
    }
  }
  const selectedHashes = new Set([...evidence.selected.map((row) => row.hash), smoke?.hash].filter(Boolean));
  md.push("## Transactions (receipts fetched from the chain)", "", "| Scope | Step | Signer | Tx | Block | Status | ETH sent | Gas used | Fee | Events |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    md.push(`| ${selectedHashes.has(r.hash) ? "selected run" : "other recorded"} | ${r.label} | ${r.from ?? "-"} | ${link("tx", r.hash)} | ${r.block ?? "-"} | ${r.status} | ${r.value === undefined || r.value === 0n ? "-" : eth(r.value)} | ${r.gasUsed ?? "-"} | ${r.fee !== undefined ? eth(r.fee) : "-"} | ${(r.events ?? []).join(", ")} |`);
  }
  if (!rows.length) md.push("| _no broadcast transactions recorded yet_ | | | | | | | | | |");
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

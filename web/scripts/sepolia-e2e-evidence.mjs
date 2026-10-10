import { keccak256, toBytes } from "viem";

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const amount = (value, expected) => value !== undefined && BigInt(value) === expected;
const ref = (runId, label) => keccak256(toBytes(`SupplyRight/${runId}/${label}`));

export const SCENARIO_STEPS = [
  { key: "mintSupplyRight", label: "1 · admin mints SupplyRight NFT to buyer", contract: "supplyRightNFT", signer: "admin",
    matches: (a, c) => same(a[0]?.poRefHash, ref(c.runId, "PO")) && same(a[0]?.buyer, c.wallets.buyer) && amount(a[0]?.contractValue, 50_000_000_000_000_000n) && amount(a[0]?.orderedQuantity, 50_000n) },
  { key: "activate", label: "1 · admin records supplier acknowledgement", contract: "supplyRightNFT", signer: "admin",
    matches: (a, c) => amount(a[0], c.rightId) && same(a[1], ref(c.runId, "SUPPLIER-ACK")) },
  { key: "recordDelivery", label: "1 · admin records delivery note (10/50 MT)", contract: "supplyRightNFT", signer: "admin",
    matches: (a, c) => amount(a[0], c.rightId) && amount(a[1], 10_000n) && same(a[2], ref(c.runId, "DELIVERY-NOTE-1")) },
  { key: "requestProtection", label: "2 · buyer requests protection", contract: "vault", signer: "buyer",
    matches: (a, c) => amount(a[0], c.rightId) && same(a[1], c.wallets.provider) && amount(a[2], 10_000_000_000_000_000n) && amount(a[3], 2_000n) && same(a[5], ref(c.runId, "TERMS")) },
  { key: "fundAndApproveProtection", label: "3 · provider funds ETH escrow + activates", contract: "vault", signer: "provider",
    matches: (a, c) => amount(a[0], c.requestId) && same(a[1], ref(c.runId, "UNDERWRITING")) },
  { key: "submitClaim", label: "4 · buyer files claim", contract: "claimManager", signer: "buyer",
    matches: (a, c) => amount(a[0], c.protectionId) && amount(a[1], 1n) && amount(a[2], 40_000_000_000_000_000n) && amount(a[3], 10_000n) && same(a[4], ref(c.runId, "EVIDENCE")) },
  { key: "approveClaim", label: "5 · verifier approves claim", contract: "claimManager", signer: "verifier",
    matches: (a, c) => amount(a[0], c.claimId) && amount(a[1], 10_000n) && amount(a[2], 40_000_000_000_000_000n) && same(a[3], ref(c.runId, "VERIFIER-REPORT")) },
  { key: "settleClaim", label: "6 · atomic settlement", contract: "claimManager", signer: "verifier",
    matches: (a, c) => amount(a[0], c.claimId) },
];

/** A PASS requires receipt evidence for this run's case, not matching labels from unrelated forge runs. */
export function verifyScenarioReceipts(rows, context) {
  const selected = [];
  const problems = [];
  for (const step of SCENARIO_STEPS) {
    const matches = rows.filter((row) =>
      row.group === "e2e" && row.status === "success" && row.functionName === step.key &&
      same(row.to, context.contracts[step.contract]) && same(row.fromAddress, context.wallets[step.signer]) &&
      Array.isArray(row.args) && step.matches(row.args, context));
    if (!matches.length) {
      problems.push(`no confirmed ${step.key} receipt for run ${context.runId} from ${step.signer}`);
      continue;
    }
    selected.push({ ...matches.sort((a, b) => Number(a.block - b.block) || a.transactionIndex - b.transactionIndex)[0], step: step.key });
  }
  for (let i = 1; i < selected.length; i++) {
    const prev = selected[i - 1];
    const next = selected[i];
    if (next.block < prev.block || (next.block === prev.block && next.transactionIndex <= prev.transactionIndex)) {
      problems.push(`${next.step} receipt precedes ${prev.step} for run ${context.runId}`);
    }
  }
  return { selected, problems };
}

export function verifySmokeTransfer(rows, runId, buyer, verifier) {
  const selected = rows.find((row) =>
    row.group === "transfer" && row.runId === runId && row.status === "success" && same(row.fromAddress, buyer) &&
    same(row.to, verifier) && row.value === 1_000_000_000_000_000n && row.input === "0x");
  return selected ?? null;
}

/** A fork can share Sepolia's chain ID while its transactions exist only on the local node. */
export function isLocalReport(rpcUrl, label = "") {
  if (/^LOCAL FORK\b/i.test(label.trim())) return true;
  try {
    const host = new URL(rpcUrl).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" ||
      host === "::1" || host === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function explorerReference(kind, value, explorer, localReport) {
  if (localReport) return `\`${value}\``;
  const caption = kind === "tx" ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  return `[${caption}](${explorer}/${kind}/${value})`;
}

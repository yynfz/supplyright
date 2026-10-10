import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { SCENARIO_STEPS, explorerReference, isLocalReport, verifyScenarioReceipts, verifySmokeTransfer } from "../scripts/sepolia-e2e-evidence.mjs";

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const context = {
  runId: "SEPOLIA-E2E-TEST-1",
  wallets: { admin: address(1), buyer: address(2), provider: address(3), verifier: address(4) },
  contracts: { supplyRightNFT: address(11), vault: address(12), claimManager: address(13) },
  rightId: 7n,
  requestId: 8n,
  protectionId: 9n,
  claimId: 10n,
};
const ref = (label, runId = context.runId) => keccak256(toBytes(`SupplyRight/${runId}/${label}`));
const inputs = [
  [{ buyer: context.wallets.buyer, poRefHash: ref("PO"), contractValue: 50_000_000_000_000_000n, orderedQuantity: 50_000n }],
  [7n, ref("SUPPLIER-ACK")],
  [7n, 10_000n, ref("DELIVERY-NOTE-1")],
  [7n, context.wallets.provider, 10_000_000_000_000_000n, 2_000, 123456n, ref("TERMS")],
  [8n, ref("UNDERWRITING")],
  [9n, 1, 40_000_000_000_000_000n, 10_000n, ref("EVIDENCE")],
  [10n, 10_000n, 40_000_000_000_000_000n, ref("VERIFIER-REPORT")],
  [10n],
];
const rows = () => SCENARIO_STEPS.map((step, i) => ({
  group: "e2e",
  status: "success",
  functionName: step.key,
  fromAddress: context.wallets[step.signer],
  to: context.contracts[step.contract],
  args: inputs[i],
  block: BigInt(100 + i),
  transactionIndex: 0,
  value: step.key === "fundAndApproveProtection" ? 10_000_000_000_000_000n : 0n,
}));

test("each real step receipt must belong to the selected run and signer", () => {
  const result = verifyScenarioReceipts(rows(), context);
  assert.equal(result.selected.length, 8);
  assert.deepEqual(result.problems, []);
});

test("a settled case cannot pass without its earlier mint receipt", () => {
  const result = verifyScenarioReceipts(rows().slice(1), context);
  assert.equal(result.selected.length, 7);
  assert.match(result.problems.join("\n"), /no confirmed mintSupplyRight receipt/);
});

test("a mint receipt from another run cannot fill the selected run's gap", () => {
  const mixed = rows();
  mixed[0] = { ...mixed[0], args: [{ ...mixed[0].args[0], poRefHash: ref("PO", "SEPOLIA-E2E-OTHER") }] };
  const result = verifyScenarioReceipts(mixed, context);
  assert.match(result.problems.join("\n"), /no confirmed mintSupplyRight receipt/);
});

test("wrong signer, contract or case ID do not count as proof", () => {
  const mixed = rows();
  mixed[2] = { ...mixed[2], fromAddress: context.wallets.buyer };
  mixed[4] = { ...mixed[4], to: context.contracts.claimManager };
  mixed[6] = { ...mixed[6], args: [999n, ...mixed[6].args.slice(1)] };
  const result = verifyScenarioReceipts(mixed, context);
  assert.equal(result.selected.length, 5);
  assert.match(result.problems.join("\n"), /recordDelivery/);
  assert.match(result.problems.join("\n"), /fundAndApproveProtection/);
  assert.match(result.problems.join("\n"), /approveClaim/);
});

test("direct transfer is separately confirmed by signer, destination, value and calldata", () => {
  const transfer = { group: "transfer", runId: context.runId, status: "success", fromAddress: context.wallets.buyer,
    to: context.wallets.verifier, value: 1_000_000_000_000_000n, input: "0x" };
  assert.equal(verifySmokeTransfer([transfer], context.runId, context.wallets.buyer, context.wallets.verifier), transfer);
  assert.equal(verifySmokeTransfer([{ ...transfer, runId: "another-run" }], context.runId, context.wallets.buyer, context.wallets.verifier), null);
  assert.equal(verifySmokeTransfer([{ ...transfer, value: 2n }], context.runId, context.wallets.buyer, context.wallets.verifier), null);
  assert.equal(verifySmokeTransfer([{ ...transfer, status: "reverted" }], context.runId, context.wallets.buyer, context.wallets.verifier), null);
});

test("local fork hashes remain plain code while real Sepolia hashes link to Etherscan", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const explorer = "https://sepolia.etherscan.io";
  assert.equal(isLocalReport("http://127.0.0.1:8545", ""), true);
  assert.equal(isLocalReport("http://localhost:8545", ""), true);
  assert.equal(isLocalReport("https://example-rpc.org", "LOCAL FORK REHEARSAL - not Sepolia"), true);
  assert.equal(explorerReference("tx", hash, explorer, true), `\`${hash}\``);
  assert.equal(explorerReference("address", address(1), explorer, true), `\`${address(1)}\``);
  assert.equal(isLocalReport("https://ethereum-sepolia-rpc.publicnode.com", "live Sepolia"), false);
  assert.equal(explorerReference("tx", hash, explorer, false), `[${hash.slice(0, 10)}…${hash.slice(-6)}](${explorer}/tx/${hash})`);
});

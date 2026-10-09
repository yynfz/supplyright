/**
 * Real RPC end-to-end check on an owned, disposable Anvil process.
 * Never connects to an existing Anvil, writes deployment files, or touches Supabase.
 * Run from web: node --import tsx scripts/smoke-protocol.ts (requires forge build artifacts).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, parseEther, stringToHex, type Abi, type Address, type Hex, type WalletClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { Deployment } from "../src/lib/deployments";
import { fetchProtocolEvents } from "../src/lib/protocol/events";
import { fetchSnapshot } from "../src/lib/protocol/snapshot";
import { ROLES } from "../src/lib/protocol/roles";
import { ClaimStatus, DefaultType, ProtectionClaimStatus, SupplyStatus } from "../src/lib/protocol/types";

const HOST = "127.0.0.1";
const PORT = 8547;
const RPC = `http://${HOST}:${PORT}`;
const CHAIN_ID = 31337;
// Public Anvil fixture mnemonic; never use real wallets in this test.
const MNEMONIC = "test test test test test test test test test test test junk";
const transport = () => http(RPC, { timeout: 10_000, retryCount: 0 });
const client = createPublicClient({ transport: transport(), pollingInterval: 100, cacheTime: 0 });
const wallets = Array.from({ length: 4 }, (_, addressIndex) => createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex }), chain: foundry, transport: transport() }));
const [admin, buyer, provider, verifier] = wallets;
const hashDocument = (text: string) => `0x${createHash("sha256").update(text).digest("hex")}` as Hex;
const receipts: { step: string; hash: Hex; block: string }[] = [];

async function requireFreePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(PORT, HOST, () => probe.close((error) => error ? reject(error) : resolve()));
  }).catch(() => { throw new Error(`Port ${PORT} is already in use. Refusing to use or stop an existing process.`); });
}

async function artifact(name: string): Promise<{ abi: Abi; bytecode: Hex }> {
  const value = JSON.parse(await readFile(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  const bytecode = value.bytecode?.object;
  if (!Array.isArray(value.abi) || typeof bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(bytecode)) {
    throw new Error(`Missing compiled ABI/bytecode for ${name}. Run forge build in contracts first.`);
  }
  return { abi: value.abi, bytecode: bytecode as Hex };
}

async function confirmed(step: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${step} reverted`);
  receipts.push({ step, hash, block: receipt.blockNumber.toString() });
  return receipt;
}

async function send(wallet: WalletClient, address: Address, abi: Abi, functionName: string, args: readonly unknown[], step: string) {
  const account = wallet.account;
  assert.ok(account, "Fixture wallet must have an account");
  await client.simulateContract({ address, abi, functionName, args, account });
  const hash = await wallet.writeContract({ address, abi, functionName, args, account, chain: foundry });
  return confirmed(step, hash);
}

async function customRpc(method: string, params: unknown[]) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`Owned Anvil RPC HTTP ${response.status}`);
  const result = await response.json() as { error?: { message: string }; result?: unknown };
  if (result.error) throw new Error(result.error.message);
  return result.result;
}

function isRevert(error: unknown, name: string) {
  if (!(error instanceof BaseError)) return false;
  const reverted = error.walk((nested) => nested instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === name;
}

async function runProtocol() {
  assert.equal(new URL(RPC).hostname, HOST);
  assert.equal(await client.getChainId(), CHAIN_ID, "Only the owned Anvil chain is allowed");
  assert.equal(await client.getBlockNumber(), 0n, "Owned chain must be fresh before deployment");
  const rpcAccounts = await customRpc("eth_accounts", []) as string[];
  assert.deepEqual(rpcAccounts.map((address) => address.toLowerCase()), wallets.map((wallet) => wallet.account.address.toLowerCase()), "RPC accounts must be the four public fixture wallets");

  const artifacts = Object.fromEntries(await Promise.all(["MockETH", "SupplyRightNFT", "ProtectionNFT", "RecoveryClaimNFT", "SupplyProtectionVault", "SupplyClaimManager"].map(async (name) => [name, await artifact(name)])));
  async function deploy(name: string, args: readonly unknown[] = []) {
    const { abi, bytecode } = artifacts[name];
    const hash = await admin.deployContract({ abi, bytecode, args });
    const receipt = await confirmed(`deploy ${name}`, hash);
    assert.ok(receipt.contractAddress, `${name} must return a deployed address`);
    return receipt.contractAddress;
  }
  const settlementToken = await deploy("MockETH");
  const supplyRightNFT = await deploy("SupplyRightNFT", [admin.account.address]);
  const protectionNFT = await deploy("ProtectionNFT", [admin.account.address]);
  const recoveryClaimNFT = await deploy("RecoveryClaimNFT", [admin.account.address]);
  const vault = await deploy("SupplyProtectionVault", [admin.account.address, settlementToken, supplyRightNFT, protectionNFT]);
  const settlementDelay = 60;
  const claimManager = await deploy("SupplyClaimManager", [admin.account.address, supplyRightNFT, vault, recoveryClaimNFT, settlementDelay, 3 * 86400]);
  const d: Deployment = { chainId: CHAIN_ID, startBlock: 0, deployer: admin.account.address, mockToken: true, settlementToken, supplyRightNFT, protectionNFT, recoveryClaimNFT, vault, claimManager };
  const rightsAbi = artifacts.SupplyRightNFT.abi;
  const vaultAbi = artifacts.SupplyProtectionVault.abi;
  const tokenAbi = artifacts.MockETH.abi;
  const claimsAbi = artifacts.SupplyClaimManager.abi;
  await send(admin, protectionNFT, artifacts.ProtectionNFT.abi, "bindVault", [vault], "bind protection vault");
  await send(admin, recoveryClaimNFT, artifacts.RecoveryClaimNFT.abi, "bindClaimManager", [claimManager], "bind recovery manager");
  await send(admin, supplyRightNFT, rightsAbi, "bindProtocol", [vault, claimManager], "bind supply protocol");
  await send(admin, vault, vaultAbi, "bindClaimManager", [claimManager], "bind vault manager");
  await send(admin, supplyRightNFT, rightsAbi, "grantRole", [ROLES.REGISTRAR_ROLE, admin.account.address], "grant registrar");
  await send(admin, supplyRightNFT, rightsAbi, "grantRole", [ROLES.BUYER_ROLE, buyer.account.address], "grant buyer");
  await send(admin, vault, vaultAbi, "grantRole", [ROLES.PROVIDER_ROLE, provider.account.address], "grant provider");
  await send(admin, claimManager, claimsAbi, "grantRole", [ROLES.VERIFIER_ROLE, verifier.account.address], "grant independent verifier");
  const deadline = (await client.getBlock()).timestamp + 3600n;
  const deliveryHash = hashDocument("Isolated smoke fixture: 10 MT received out of 50 MT");
  await send(admin, supplyRightNFT, rightsAbi, "mintSupplyRight", [{ buyer: buyer.account.address, poRefHash: hashDocument("Isolated smoke PO"), agreementHash: hashDocument("Isolated smoke signed supply agreement"), supplierRefHash: hashDocument("Isolated smoke salted supplier reference"), contractValue: parseEther("100"), orderedQuantity: 50_000n, deliveryDeadline: deadline, unit: stringToHex("MT", { size: 8 }) }], "mint Supply Right");
  await send(admin, supplyRightNFT, rightsAbi, "activate", [1n, hashDocument("Isolated smoke supplier acknowledgement")], "activate supply obligation");
  await send(admin, supplyRightNFT, rightsAbi, "recordDelivery", [1n, 10_000n, deliveryHash], "record partial delivery");
  await send(buyer, vault, vaultAbi, "requestProtection", [1n, provider.account.address, parseEther("20"), 2000, deadline + 86400n, hashDocument("Isolated smoke 20 percent coverage terms")], "buyer requests protection");
  await send(provider, settlementToken, tokenAbi, "faucet", [parseEther("20")], "provider takes demo collateral");
  await send(provider, settlementToken, tokenAbi, "approve", [vault, parseEther("20")], "approve token allowance");
  await send(provider, vault, vaultAbi, "fundAndApproveProtection", [1n, hashDocument("Isolated smoke underwriting memo")], "fund and activate protection");
  const evidenceHash = hashDocument("Isolated smoke evidence: 40 MT undelivered and 80 mETH eligible loss");
  await assert.rejects(client.simulateContract({ address: claimManager, abi: claimsAbi, functionName: "submitClaim", args: [1n, DefaultType.Partial, parseEther("80"), 10_000n, evidenceHash], account: buyer.account }), (error) => isRevert(error, "DeliveryDeadlineNotReached"));
  await customRpc("evm_increaseTime", [3601]);
  await customRpc("evm_mine", []);
  await send(buyer, claimManager, claimsAbi, "submitClaim", [1n, DefaultType.Partial, parseEther("80"), 10_000n, evidenceHash], "buyer submits partial default");
  const submitted = await fetchSnapshot(client, d);
  assert.equal(submitted.claims[0].status, ClaimStatus.Submitted);
  assert.equal(submitted.supplyRights[0].status, SupplyStatus.UnderAssessment);
  assert.equal(submitted.protections[0].claimOpen, true);
  assert.equal(submitted.recoveries.length, 0);
  await send(verifier, claimManager, claimsAbi, "approveClaim", [1n, 10_000n, parseEther("80"), hashDocument("Isolated smoke independent verifier report")], "independent verifier approves loss");
  await assert.rejects(client.simulateContract({ address: claimManager, abi: claimsAbi, functionName: "settleClaim", args: [1n], account: admin.account }), (error) => isRevert(error, "SettlementDelayActive"));
  await customRpc("evm_increaseTime", [settlementDelay + 1]);
  await customRpc("evm_mine", []);
  const settlement = await send(admin, claimManager, claimsAbi, "settleClaim", [1n], "permissionless atomic settlement");
  const [snapshot, events, buyerBalance] = await Promise.all([
    fetchSnapshot(client, d),
    fetchProtocolEvents(client, d),
    client.readContract({ address: settlementToken, abi: tokenAbi, functionName: "balanceOf", args: [buyer.account.address] }),
  ]);
  assert.equal(buyerBalance, parseEther("16"));
  assert.equal(snapshot.token.symbol, "mETH");
  assert.equal(snapshot.token.decimals, 18);
  assert.equal(snapshot.supplyRights.length, 1);
  assert.equal(snapshot.supplyRights[0].status, SupplyStatus.Defaulted);
  assert.equal(snapshot.protections[0].lockedAmount, parseEther("4"));
  assert.equal(snapshot.protections[0].paidAmount, parseEther("16"));
  assert.equal(snapshot.protections[0].claimOpen, false);
  assert.equal(snapshot.protections[0].nftClaimStatus, ProtectionClaimStatus.PartiallyPaid);
  assert.equal(snapshot.claims[0].status, ClaimStatus.Settled);
  assert.equal(snapshot.claims[0].recoveryTokenId, 1);
  assert.equal(snapshot.claims[0].payoutAmount, parseEther("16"));
  assert.equal(snapshot.recoveries[0].owner.toLowerCase(), provider.account.address.toLowerCase());
  assert.equal(snapshot.recoveries[0].compensationAmount, parseEther("16"));
  assert.equal(snapshot.recoveries[0].settledBlock, Number(settlement.blockNumber));
  assert.equal(snapshot.vault.totalPaidOut, parseEther("16"));
  assert.equal(snapshot.vault.totalLocked, parseEther("4"));
  assert.equal(snapshot.vault.tokenBalance, snapshot.vault.totalFree + snapshot.vault.totalLocked);
  const atomicEvents = events.filter((event) => event.transactionHash === settlement.transactionHash);
  const settled = atomicEvents.find((event) => event.contract === "claimManager" && event.name === "ClaimSettled");
  const payout = atomicEvents.find((event) => event.contract === "vault" && event.name === "PayoutExecuted");
  const recovery = atomicEvents.find((event) => event.contract === "recoveryClaimNFT" && event.name === "RecoveryClaimMinted");
  assert.ok(settled && payout && recovery, "Settlement, payout, and recovery mint must share the same successful transaction");
  assert.equal(settled.args.payoutAmount, parseEther("16"));
  assert.equal(settled.args.recoveryTokenId, 1n);
  assert.equal(settled.args.beneficiary, buyer.account.address);
  assert.equal(recovery.args.provider, provider.account.address);
  assert.equal(snapshot.recoveries[0].settlementRef, settled.args.settlementRef);
  console.log(JSON.stringify({ result: "passed", rpc: RPC, chainId: CHAIN_ID, transactions: receipts, eventsRead: events.length, buyerPayout: "16 mETH", remainingLocked: "4 mETH", recoveryOwner: snapshot.recoveries[0].owner, settlementHash: settlement.transactionHash, settlementBlock: settlement.blockNumber.toString() }, null, 2));
}

async function main() {
  await requireFreePort();
  const executable = process.env.SUPPLYRIGHT_ANVIL_PATH || (process.platform === "win32" ? join(homedir(), ".foundry", "bin", "anvil.exe") : "anvil");
  let child: ChildProcess | undefined;
  let launchError: Error | undefined;
  try {
    child = spawn(executable, ["--host", HOST, "--port", String(PORT), "--chain-id", String(CHAIN_ID), "--accounts", "4", "--mnemonic", MNEMONIC, "--silent"], { windowsHide: true, stdio: "ignore" });
    child.once("error", (error) => { launchError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (launchError) throw new Error(`Unable to launch owned Anvil: ${launchError.message}`);
      if (child.exitCode !== null) throw new Error("Owned Anvil exited before accepting RPC requests.");
      try { await client.getChainId(); ready = true; break; } catch { await delay(100); }
    }
    if (!ready) throw new Error("Owned Anvil did not become ready.");
    await runProtocol();
  } finally {
    // The handle is only the fresh process spawned above. Never discover or kill other port owners.
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise<void>((resolve) => child!.once("exit", () => resolve())), delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) throw new Error(`Owned Anvil process ${child.pid} did not stop after the test.`);
    }
  }
}

main().catch((error: unknown) => {
  // Do not print wallet objects, process environment, or unbounded RPC error/ABI payloads.
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "Unknown failure";
  console.error(`Protocol smoke failed: ${message}`);
  process.exitCode = 1;
});

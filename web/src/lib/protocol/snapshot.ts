import type { Address, PublicClient } from "viem";
import {
  claimManagerAbi,
  mockEthAbi,
  protectionNftAbi,
  recoveryClaimNftAbi,
  supplyRightNftAbi,
  vaultAbi,
} from "@/generated/abis";
import type { Deployment } from "@/lib/deployments";
import type {
  Claim,
  Protection,
  ProtectionRequest,
  ProtocolSnapshot,
  RecoveryClaim,
  SupplyRight,
} from "./types";

const PAGE = 500n;

function bytes8ToString(hex: string) {
  const clean = hex.replace(/^0x/, "");
  let s = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s;
}

/**
 * Reads the full protocol state through the contracts' paged view functions. Everything returned here is
 * public onchain data; no application database is involved.
 */
export async function fetchSnapshot(client: PublicClient, d: Deployment): Promise<ProtocolSnapshot> {
  const block = await client.getBlock();

  const [rawRights, rawRequests, rawProtections, rawClaims, rawRecoveries] = await Promise.all([
    client.readContract({ address: d.supplyRightNFT, abi: supplyRightNftAbi, functionName: "getSupplyRights", args: [1n, PAGE] }),
    client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getRequests", args: [1n, PAGE] }),
    client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getProtections", args: [1n, PAGE] }),
    client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "getClaims", args: [1n, PAGE] }),
    client.readContract({ address: d.recoveryClaimNFT, abi: recoveryClaimNftAbi, functionName: "getRecoveryClaims", args: [1n, PAGE] }),
  ]);

  const [totalFree, totalLocked, totalPaidOut, settlementDelay, appealWindow, tokenBalance, symbol, decimals, name] =
    await Promise.all([
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: "totalFreeCollateral" }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: "totalLockedCollateral" }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: "totalPaidOut" }),
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "settlementDelay" }),
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "appealWindow" }),
      client.readContract({ address: d.settlementToken, abi: mockEthAbi, functionName: "balanceOf", args: [d.vault] }),
      client.readContract({ address: d.settlementToken, abi: mockEthAbi, functionName: "symbol" }),
      client.readContract({ address: d.settlementToken, abi: mockEthAbi, functionName: "decimals" }),
      client.readContract({ address: d.settlementToken, abi: mockEthAbi, functionName: "name" }),
    ]);

  const ownerOf = (address: Address, abi: typeof supplyRightNftAbi | typeof protectionNftAbi | typeof recoveryClaimNftAbi, id: number) =>
    client
      .readContract({ address, abi: abi as typeof supplyRightNftAbi, functionName: "ownerOf", args: [BigInt(id)] })
      .catch(() => null);

  const rightOwners = await Promise.all(rawRights.map((_, i) => ownerOf(d.supplyRightNFT, supplyRightNftAbi, i + 1)));
  const protectionMeta = await Promise.all(
    rawProtections.map(async (_, i) => {
      const id = BigInt(i + 1);
      const [terms, owner] = await Promise.all([
        client.readContract({ address: d.protectionNFT, abi: protectionNftAbi, functionName: "getTerms", args: [id] }).catch(() => null),
        ownerOf(d.protectionNFT, protectionNftAbi, i + 1),
      ]);
      return { claimStatus: terms ? Number(terms.claimStatus) : 0, owner };
    }),
  );
  const recoveryOwners = await Promise.all(
    rawRecoveries.map((_, i) => ownerOf(d.recoveryClaimNFT, recoveryClaimNftAbi, i + 1)),
  );

  const supplyRights: SupplyRight[] = rawRights.map((r, i) => ({
    id: i + 1,
    owner: (rightOwners[i] ?? r.buyer) as Address,
    buyer: r.buyer,
    deliveryDeadline: Number(r.deliveryDeadline),
    registeredAt: Number(r.registeredAt),
    status: Number(r.status),
    unit: bytes8ToString(r.unit) || "MT",
    poRefHash: r.poRefHash,
    agreementHash: r.agreementHash,
    supplierRefHash: r.supplierRefHash,
    supplierAckHash: r.supplierAckHash,
    contractValue: r.contractValue,
    orderedQuantity: r.orderedQuantity,
    deliveredQuantity: r.deliveredQuantity,
    protectionId: Number(r.protectionId),
  }));

  const requests: ProtectionRequest[] = rawRequests.map((r, i) => ({
    id: i + 1,
    supplyRightId: Number(r.supplyRightId),
    buyer: r.buyer,
    provider: r.provider,
    coverageAmount: r.coverageAmount,
    coverageBps: Number(r.coverageBps),
    expiresAt: Number(r.expiresAt),
    requestedAt: Number(r.requestedAt),
    decidedAt: Number(r.decidedAt),
    status: Number(r.status),
    protectionId: Number(r.protectionId),
    termsHash: r.termsHash,
    decisionHash: r.decisionHash,
  }));

  const protections: Protection[] = rawProtections.map((p, i) => ({
    id: i + 1,
    supplyRightId: Number(p.supplyRightId),
    requestId: Number(p.requestId),
    provider: p.provider,
    beneficiary: p.beneficiary,
    coverageAmount: p.coverageAmount,
    lockedAmount: p.lockedAmount,
    paidAmount: p.paidAmount,
    releasedAmount: p.releasedAmount,
    coverageBps: Number(p.coverageBps),
    startsAt: Number(p.startsAt),
    expiresAt: Number(p.expiresAt),
    claimOpen: p.claimOpen,
    status: Number(p.status),
    termsHash: p.termsHash,
    nftClaimStatus: protectionMeta[i].claimStatus,
    nftOwner: protectionMeta[i].owner as Address | null,
  }));

  const claims: Claim[] = rawClaims.map((c, i) => ({
    id: i + 1,
    supplyRightId: Number(c.supplyRightId),
    protectionId: Number(c.protectionId),
    claimant: c.claimant,
    verifier: c.verifier,
    objector: c.objector,
    claimedType: Number(c.claimedType),
    verifiedType: Number(c.verifiedType),
    status: Number(c.status),
    submittedAt: Number(c.submittedAt),
    decidedAt: Number(c.decidedAt),
    settledAt: Number(c.settledAt),
    claimedLoss: c.claimedLoss,
    reportedDeliveredQuantity: c.reportedDeliveredQuantity,
    verifiedDeliveredQuantity: c.verifiedDeliveredQuantity,
    approvedLoss: c.approvedLoss,
    payoutAmount: c.payoutAmount,
    recoveryTokenId: Number(c.recoveryTokenId),
    evidenceHash: c.evidenceHash,
    decisionHash: c.decisionHash,
    objectionHash: c.objectionHash,
  }));

  const recoveries: RecoveryClaim[] = rawRecoveries.map((r, i) => ({
    id: i + 1,
    owner: (recoveryOwners[i] ?? r.provider) as Address,
    supplyRightId: Number(r.supplyRightId),
    claimId: Number(r.claimId),
    protectionId: Number(r.protectionId),
    provider: r.provider,
    compensationAmount: r.compensationAmount,
    recoveryAmount: r.recoveryAmount,
    recoveredAmount: r.recoveredAmount,
    evidenceHash: r.evidenceHash,
    decisionHash: r.decisionHash,
    settlementRef: r.settlementRef,
    lastUpdateHash: r.lastUpdateHash,
    settledAt: Number(r.settledAt),
    settledBlock: Number(r.settledBlock),
    status: Number(r.status),
  }));

  return {
    chainId: d.chainId,
    blockNumber: block.number,
    blockTimestamp: Number(block.timestamp),
    supplyRights,
    requests,
    protections,
    claims,
    recoveries,
    vault: { totalFree, totalLocked, totalPaidOut, tokenBalance },
    settings: { settlementDelay: Number(settlementDelay), appealWindow: Number(appealWindow) },
    token: { symbol, decimals: Number(decimals), name },
  };
}

/** Contract value of the undelivered quantity (mirrors SupplyRightNFT.undeliveredValue). */
export function undeliveredValue(r: Pick<SupplyRight, "orderedQuantity" | "contractValue">, delivered: bigint) {
  if (r.orderedQuantity === 0n || delivered >= r.orderedQuantity) return 0n;
  return ((r.orderedQuantity - delivered) * r.contractValue) / r.orderedQuantity;
}

/** Mirrors SupplyProtectionVault.quotePayout. */
export function quotePayout(p: Protection | undefined, eligibleLoss: bigint) {
  if (!p || p.status !== 1) return 0n;
  const gross = (eligibleLoss * BigInt(p.coverageBps)) / 10_000n;
  const remaining = p.coverageAmount - p.paidAmount;
  const cap = p.lockedAmount < remaining ? p.lockedAmount : remaining;
  return gross < cap ? gross : cap;
}

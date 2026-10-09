import type { Address } from "viem";
import { formatBps, formatQty, formatToken, shortAddress } from "@/lib/format";
import type { ProtocolEvent } from "./events";
import {
  claimStatusLabel,
  protectionClaimStatusLabel,
  recoveryStatusLabel,
  supplyStatusLabel,
  type Tone,
} from "./labels";
import { ClaimStatus, DefaultType, ProtectionClaimStatus, RecoveryStatus, SupplyStatus } from "./types";
import { ROLE_HASHES } from "./roles";

export type EventDescription = { title: string; detail?: string; tone: Tone; important?: boolean };

const big = (v: unknown) => (typeof v === "bigint" ? v : BigInt((v as number) ?? 0));
const num = (v: unknown) => Number(v as bigint);
const addr = (v: unknown) => shortAddress(v as Address);

/** Human-readable (Bahasa Indonesia) description of a protocol event for audit timelines. */
export function describeEvent(e: ProtocolEvent): EventDescription {
  const a = e.args;
  switch (e.name) {
    case "SupplyRightMinted":
      return {
        title: `Supply Right #${num(a.tokenId)} dicetak`,
        detail: `Untuk ${addr(a.buyer)} · ${formatQty(big(a.orderedQuantity))} · nilai ${formatToken(big(a.contractValue))}`,
        tone: "navy",
        important: true,
      };
    case "SupplierAcknowledged":
      return { title: `Konfirmasi pemasok dicatat (SR #${num(a.tokenId)})`, tone: "info" };
    case "SupplyRightStatusChanged": {
      const to = supplyStatusLabel[num(a.to) as SupplyStatus];
      const from = supplyStatusLabel[num(a.from) as SupplyStatus];
      return { title: `Status SR #${num(a.tokenId)}: ${from.label} → ${to.label}`, tone: to.tone };
    }
    case "DeliveryRecorded":
      return {
        title: `Pengiriman tercatat (SR #${num(a.tokenId)})`,
        detail: `Kumulatif diterima ${formatQty(big(a.deliveredQuantity))} · oleh ${addr(a.actor)}`,
        tone: "info",
      };
    case "ProtectionLinked":
      return { title: `Proteksi #${num(a.protectionId)} terhubung ke SR #${num(a.tokenId)}`, tone: "teal" };
    case "TransferAuthorized":
      return { title: `Transfer token #${num(a.tokenId)} diotorisasi ke ${addr(a.recipient)}`, tone: "warning" };
    case "Transfer":
      if (/^0x0{40}$/i.test(a.from as string)) {
        return { title: `NFT #${num(a.tokenId)} diterbitkan ke ${addr(a.to)}`, tone: "neutral" };
      }
      return { title: `NFT #${num(a.tokenId)} dipindahkan ${addr(a.from)} → ${addr(a.to)}`, tone: "warning" };
    case "ProtectionRequested":
      return {
        title: `Permintaan proteksi #${num(a.requestId)} untuk SR #${num(a.supplyRightId)}`,
        detail: `Coverage ${formatToken(big(a.coverageAmount))} @ ${formatBps(num(a.coverageBps))} dari kerugian layak`,
        tone: "info",
      };
    case "ProtectionRequestRejected":
      return { title: `Permintaan proteksi #${num(a.requestId)} ditolak provider`, tone: "danger" };
    case "ProtectionRequestCancelled":
      return { title: `Permintaan proteksi #${num(a.requestId)} dibatalkan pembeli`, tone: "neutral" };
    case "CollateralDeposited":
      return {
        title: `Collateral disetor ${formatToken(big(a.amount))}`,
        detail: `Provider ${addr(a.provider)} · saldo bebas ${formatToken(big(a.freeBalance))}`,
        tone: "teal",
        important: true,
      };
    case "CollateralWithdrawn":
      return {
        title: `Collateral bebas ditarik ${formatToken(big(a.amount))}`,
        detail: `Provider ${addr(a.provider)}`,
        tone: "neutral",
      };
    case "ProtectionActivated":
      return {
        title: `Proteksi #${num(a.protectionId)} aktif — ${formatToken(big(a.lockedAmount))} dikunci`,
        detail: `Provider ${addr(a.provider)} · penerima manfaat ${addr(a.beneficiary)}`,
        tone: "teal",
        important: true,
      };
    case "ProtectionMinted":
      return {
        title: `Protection NFT #${num(a.tokenId)} diterbitkan`,
        detail: `Penerima manfaat ${addr(a.beneficiary)}`,
        tone: "teal",
      };
    case "ProtectionClaimStatusChanged": {
      const l = protectionClaimStatusLabel[num(a.status) as ProtectionClaimStatus];
      return { title: `Status klaim Proteksi #${num(a.tokenId)}: ${l.label}`, tone: l.tone };
    }
    case "ClaimOpenedOnProtection":
      return { title: `Klaim dibuka pada Proteksi #${num(a.protectionId)}`, tone: "warning" };
    case "ClaimClosedOnProtection":
      return { title: `Klaim ditutup pada Proteksi #${num(a.protectionId)}`, tone: "neutral" };
    case "PayoutExecuted":
      return {
        title: `Kompensasi ${formatToken(big(a.amount))} dibayarkan`,
        detail: `Ke ${addr(a.beneficiary)} · sisa terkunci ${formatToken(big(a.remainingLocked))}`,
        tone: "success",
        important: true,
      };
    case "CollateralReleased":
      return {
        title: `Collateral ${formatToken(big(a.amount))} dilepas ke saldo bebas provider`,
        detail: `Proteksi #${num(a.protectionId)}`,
        tone: "neutral",
      };
    case "ClaimSubmitted":
      return {
        title: `Klaim #${num(a.claimId)} diajukan (${num(a.claimType) === DefaultType.Complete ? "default penuh" : "default sebagian"})`,
        detail: `Kerugian diklaim ${formatToken(big(a.claimedLoss))} · dilaporkan diterima ${formatQty(big(a.reportedDeliveredQuantity))}`,
        tone: "warning",
        important: true,
      };
    case "ClaimApproved":
      return {
        title: `Klaim #${num(a.claimId)} disetujui verifikator${a.viaAttestation ? " (atestasi EIP-712)" : ""}`,
        detail: `Kerugian layak ${formatToken(big(a.approvedLoss))} → kompensasi ${formatToken(big(a.payoutAmount))} · terverifikasi diterima ${formatQty(big(a.verifiedDeliveredQuantity))}`,
        tone: "info",
        important: true,
      };
    case "ClaimRejected":
      return { title: `Klaim #${num(a.claimId)} ditolak verifikator`, detail: String(a.reason ?? ""), tone: "danger", important: true };
    case "ClaimDisputed":
      return {
        title: `Keberatan atas Klaim #${num(a.claimId)}`,
        detail: `Oleh ${addr(a.objector)} · status sebelumnya ${claimStatusLabel[num(a.previous) as ClaimStatus].label}`,
        tone: "danger",
      };
    case "ClaimWithdrawn":
      return { title: `Klaim #${num(a.claimId)} ditarik pembeli`, tone: "neutral" };
    case "ClaimSettled":
      return {
        title: `Settlement atomik Klaim #${num(a.claimId)}`,
        detail: `${formatToken(big(a.payoutAmount))} ke ${addr(a.beneficiary)} + Recovery Claim NFT #${num(a.recoveryTokenId)} ke ${addr(a.provider)} dalam satu transaksi`,
        tone: "success",
        important: true,
      };
    case "RecoveryClaimMinted":
      return {
        title: `Recovery Claim NFT #${num(a.tokenId)} diterbitkan`,
        detail: `Untuk ${addr(a.provider)} · nilai ${formatToken(big(a.compensationAmount))}`,
        tone: "warning",
        important: true,
      };
    case "RecoveryUpdated": {
      const l = recoveryStatusLabel[num(a.status) as RecoveryStatus];
      return {
        title: `Pemulihan #${num(a.tokenId)}: ${l.label}`,
        detail: `Terpulihkan ${formatToken(big(a.recoveredAmount))} (dilaporkan pemegang)`,
        tone: l.tone,
      };
    }
    case "SettlementDelayUpdated":
      return { title: `Jeda settlement diatur ke ${num(a.delay)} detik`, tone: "neutral" };
    case "AppealWindowUpdated":
      return { title: `Jendela banding diatur ke ${num(a.window)} detik`, tone: "neutral" };
    case "RoleGranted":
      return {
        title: `Peran ${ROLE_HASHES[(a.role as string).toLowerCase()] ?? "?"} diberikan ke ${addr(a.account)}`,
        tone: "neutral",
      };
    case "RoleRevoked":
      return {
        title: `Peran ${ROLE_HASHES[(a.role as string).toLowerCase()] ?? "?"} dicabut dari ${addr(a.account)}`,
        tone: "neutral",
      };
    case "ProtocolBound":
    case "VaultBound":
    case "ClaimManagerBound":
      return { title: `Wiring kontrak satu kali: ${e.name}`, tone: "neutral" };
    default:
      return { title: e.name, tone: "neutral" };
  }
}

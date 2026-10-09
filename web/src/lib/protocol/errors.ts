import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeErrorResult,
  type Abi,
  type AbiItem,
  type Hex,
} from "viem";
import {
  claimManagerAbi,
  mockEthAbi,
  protectionNftAbi,
  recoveryClaimNftAbi,
  supplyRightNftAbi,
  vaultAbi,
} from "@/generated/abis";
import { formatToken, formatDateTime } from "@/lib/format";
import { ROLE_HASHES } from "./roles";
import { claimStatusLabel, supplyStatusLabel } from "./labels";
import type { ClaimStatus, SupplyStatus } from "./types";

/** Every custom error of every protocol contract, so reverts bubbling across contracts still decode. */
const ALL_ERRORS: Abi = (() => {
  const seen = new Set<string>();
  const out: AbiItem[] = [];
  for (const abi of [claimManagerAbi, vaultAbi, supplyRightNftAbi, protectionNftAbi, recoveryClaimNftAbi, mockEthAbi]) {
    for (const item of abi as readonly AbiItem[]) {
      if (item.type !== "error") continue;
      const key = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out as Abi;
})();

const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  AccessControlUnauthorizedAccount: (a) =>
    `Wallet ini tidak memiliki peran ${ROLE_HASHES[String(a[1]).toLowerCase()] ?? "yang diperlukan"}.`,
  BuyerNotAuthorized: () => "Alamat pembeli belum di-onboard (BUYER_ROLE) oleh admin.",
  DuplicatePurchaseOrder: (a) => `Purchase order ini sudah terdaftar sebagai Supply Right #${a[0]}.`,
  InvalidParams: () => "Parameter tidak valid (hash dokumen kosong, nilai nol, atau batas kirim sudah lewat).",
  InvalidStatus: (a) => `Aksi tidak diizinkan pada status ${supplyStatusLabel[Number(a[0]) as SupplyStatus]?.label ?? a[0]}.`,
  InvalidTransition: () => "Transisi status tidak valid.",
  InvalidQuantity: () => "Kuantitas tidak valid (tidak boleh turun atau melebihi kuantitas pesanan).",
  ClaimActivityPending: () => "Masih ada klaim terbuka atau penolakan yang masih bisa dibanding.",
  TransferNotAuthorized: () => "Transfer NFT dibatasi: belum ada otorisasi transfer kontraktual.",
  NonTransferable: () => "Protection NFT tidak dapat dipindahtangankan.",
  NotProtocol: () => "Hanya kontrak protokol yang terhubung yang dapat melakukan aksi ini.",
  AlreadyProtected: (a) => `Supply right sudah memiliki Proteksi #${a[0]}.`,
  RequestAlreadyPending: (a) => `Masih ada permintaan proteksi #${a[0]} yang menunggu.`,
  InvalidCoverage: () => "Coverage tidak valid (harus > 0, ≤ nilai kontrak, persentase 0,01–100%).",
  InvalidExpiry: () => "Masa berlaku proteksi harus setelah batas kirim dan maksimal 365 hari sesudahnya.",
  InvalidHash: () => "Dokumen pendukung wajib dilampirkan (hash kosong).",
  NotProvider: () => "Alamat tersebut bukan penyedia proteksi terotorisasi.",
  NotDesignatedProvider: () => "Permintaan ini ditujukan ke provider lain.",
  SelfProtection: () => "Pembeli tidak dapat menjadi provider untuk dirinya sendiri.",
  RequestNotPending: () => "Permintaan proteksi tidak lagi berstatus menunggu.",
  InsufficientFreeCollateral: (a) =>
    `Collateral bebas tidak cukup: tersedia ${formatToken(a[0] as bigint)}, dibutuhkan ${formatToken(a[1] as bigint)}.`,
  ZeroAmount: () => "Jumlah harus lebih dari nol.",
  NotBuyer: () => "Hanya pembeli (pemilik supply right) yang dapat melakukan aksi ini.",
  SupplyRightNotEligible: (a) =>
    `Supply right berstatus ${supplyStatusLabel[Number(a[0]) as SupplyStatus]?.label ?? a[0]} sehingga tidak memenuhi syarat.`,
  ProtectionNotActive: () => "Proteksi tidak aktif (habis terpakai atau sudah dilepas).",
  ProtectionExpired: (a) => `Masa proteksi sudah berakhir (${formatDateTime(Number(a[1]))}).`,
  ReleaseNotAllowed: () => "Collateral baru bisa dilepas setelah kontrak terpenuhi/ditutup atau proteksi kedaluwarsa.",
  ReleaseBlockedByClaim: () => "Collateral tertahan: ada klaim terbuka atau penolakan yang masih bisa dibanding.",
  ExcessivePayout: () => "Pembayaran melebihi sisa coverage atau dana terkunci.",
  NotClaimManager: () => "Hanya Claim Manager yang dapat memicu pembayaran.",
  NotBeneficiary: () => "Hanya penerima manfaat proteksi yang dapat mengajukan klaim.",
  SupplyRightNotClaimable: (a) =>
    `Klaim tidak dapat diajukan saat supply right berstatus ${supplyStatusLabel[Number(a[0]) as SupplyStatus]?.label ?? a[0]}.`,
  DeliveryDeadlineNotReached: (a) =>
    `Batas waktu pengiriman belum lewat (${formatDateTime(Number(a[0]))}). Klaim hanya dapat diajukan setelahnya.`,
  ClaimAlreadyOpen: (a) => `Klaim #${a[0]} masih terbuka untuk proteksi ini.`,
  InvalidEvidence: () => "Bukti klaim wajib dilampirkan.",
  EvidenceAlreadyUsed: () => "Bundel bukti ini sudah pernah dipakai untuk klaim lain.",
  InvalidDefaultType: () => "Jenis default tidak sesuai kuantitas (penuh = 0 terkirim; sebagian = 0 < terkirim < pesanan).",
  InvalidDeliveredQuantity: () => "Kuantitas terkirim tidak valid terhadap catatan yang sudah terverifikasi.",
  ExcessiveLoss: (a) => `Kerugian ${formatToken(a[0] as bigint)} melebihi batas yang dapat diakui (${formatToken(a[1] as bigint)}).`,
  InvalidClaimStatus: (a) => `Aksi tidak diizinkan: klaim berstatus ${claimStatusLabel[Number(a[0]) as ClaimStatus]?.label ?? a[0]}.`,
  VerifierConflict: () => "Konflik kepentingan: verifikator tidak boleh pembeli, penggugat, atau provider klaim ini.",
  InvalidDecision: () => "Keputusan wajib disertai laporan/penjelasan.",
  NoCoverageRemaining: () => "Tidak ada sisa coverage untuk dibayarkan.",
  SettlementDelayActive: (a) => `Masa keberatan masih berjalan. Settlement dapat dilakukan mulai ${formatDateTime(Number(a[0]))}.`,
  AppealWindowClosed: () => "Jendela banding sudah tertutup.",
  AlreadyObjected: () => "Klaim ini sudah pernah diajukan keberatan.",
  NotAuthorized: () => "Wallet ini tidak berwenang untuk aksi tersebut.",
  AttestationExpired: () => "Atestasi verifikator sudah kedaluwarsa.",
  InvalidAttestation: () => "Tanda tangan atestasi tidak valid.",
  UnknownClaim: () => "Klaim tidak ditemukan.",
  UnknownProtection: () => "Proteksi tidak ditemukan.",
  ValueTooLarge: () => "Nilai melebihi batas maksimum yang diizinkan.",
  NotHolder: () => "Hanya pemegang Recovery Claim NFT yang dapat memperbarui status pemulihan.",
  InvalidRecoveryUpdate: () => "Pembaruan pemulihan tidak valid (jumlah tidak boleh turun / status final).",
  FaucetLimitExceeded: () => "Faucet dibatasi 1.000 mETH per transaksi.",
  ERC20InsufficientBalance: () => "Saldo mETH tidak cukup. Ambil mETH uji dari faucet terlebih dahulu.",
  ERC20InsufficientAllowance: () => "Allowance mETH ke vault belum cukup. Setujui (approve) terlebih dahulu.",
  ERC721NonexistentToken: (a) => `Token #${a[0]} tidak ditemukan.`,
};

export type DecodedError = { name?: string; message: string; userRejected?: boolean };

function decodeRaw(raw?: Hex) {
  if (!raw || raw === "0x") return undefined;
  try {
    return decodeErrorResult({ abi: ALL_ERRORS, data: raw });
  } catch {
    return undefined;
  }
}

/** Turns any wallet / RPC / revert error into a helpful Indonesian message. */
export function decodeTxError(err: unknown): DecodedError {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return { name: "UserRejected", message: "Transaksi dibatalkan di wallet.", userRejected: true };
    }
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert) {
      const decoded = revert.data?.errorName ? revert.data : decodeRaw(revert.raw);
      if (decoded?.errorName) {
        const fn = MESSAGES[decoded.errorName];
        const args = (decoded.args ?? []) as readonly unknown[];
        return { name: decoded.errorName, message: fn ? fn(args) : `Transaksi ditolak kontrak: ${decoded.errorName}` };
      }
      if (revert.reason) return { name: "Revert", message: revert.reason };
    }
    const msg = err.shortMessage || err.message;
    if (/insufficient funds/i.test(msg)) {
      return { name: "InsufficientFunds", message: "ETH untuk biaya gas tidak cukup di wallet ini." };
    }
    if (/chain mismatch|does not match the target chain/i.test(msg)) {
      return { name: "ChainMismatch", message: "Jaringan wallet berbeda. Ganti jaringan ke chain aplikasi." };
    }
    return { message: msg };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: "Terjadi kesalahan tidak dikenal." };
}

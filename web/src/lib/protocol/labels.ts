import {
  ClaimStatus,
  DefaultType,
  ProtectionClaimStatus,
  ProtectionStatus,
  RecoveryStatus,
  RequestStatus,
  SupplyStatus,
} from "./types";

/** Consistent status tones used by <StatusBadge>. */
export type Tone = "neutral" | "info" | "teal" | "success" | "warning" | "danger" | "navy";

type Label = { label: string; tone: Tone; hint?: string };

export const supplyStatusLabel: Record<SupplyStatus, Label> = {
  [SupplyStatus.Registered]: { label: "Terdaftar", tone: "info", hint: "Dicetak registrar; menunggu konfirmasi pemasok" },
  [SupplyStatus.Active]: { label: "Aktif", tone: "teal", hint: "Kewajiban pengiriman berjalan" },
  [SupplyStatus.Fulfilled]: { label: "Terpenuhi", tone: "success", hint: "Seluruh kuantitas diterima" },
  [SupplyStatus.UnderAssessment]: { label: "Asesmen Default", tone: "warning", hint: "Klaim sedang dinilai" },
  [SupplyStatus.Defaulted]: { label: "Default Terverifikasi", tone: "danger", hint: "Default diverifikasi & diselesaikan" },
  [SupplyStatus.Closed]: { label: "Ditutup", tone: "neutral", hint: "Final; tidak ada klaim lanjutan" },
};

export const requestStatusLabel: Record<RequestStatus, Label> = {
  [RequestStatus.None]: { label: "-", tone: "neutral" },
  [RequestStatus.Pending]: { label: "Menunggu Provider", tone: "warning" },
  [RequestStatus.Approved]: { label: "Disetujui & Didanai", tone: "success" },
  [RequestStatus.Rejected]: { label: "Ditolak", tone: "danger" },
  [RequestStatus.Cancelled]: { label: "Dibatalkan", tone: "neutral" },
};

export const protectionStatusLabel: Record<ProtectionStatus, Label> = {
  [ProtectionStatus.None]: { label: "-", tone: "neutral" },
  [ProtectionStatus.Active]: { label: "Aktif", tone: "teal" },
  [ProtectionStatus.Exhausted]: { label: "Habis Terpakai", tone: "warning" },
  [ProtectionStatus.Released]: { label: "Dilepas", tone: "neutral" },
};

export const protectionClaimStatusLabel: Record<ProtectionClaimStatus, Label> = {
  [ProtectionClaimStatus.NoClaim]: { label: "Tanpa Klaim", tone: "neutral" },
  [ProtectionClaimStatus.ClaimPending]: { label: "Klaim Diajukan", tone: "warning" },
  [ProtectionClaimStatus.ClaimApproved]: { label: "Klaim Disetujui", tone: "info" },
  [ProtectionClaimStatus.Disputed]: { label: "Disengketakan", tone: "danger" },
  [ProtectionClaimStatus.PartiallyPaid]: { label: "Dibayar Sebagian", tone: "teal" },
  [ProtectionClaimStatus.Exhausted]: { label: "Habis Terpakai", tone: "warning" },
  [ProtectionClaimStatus.Released]: { label: "Dilepas", tone: "neutral" },
};

export const claimStatusLabel: Record<ClaimStatus, Label> = {
  [ClaimStatus.None]: { label: "-", tone: "neutral" },
  [ClaimStatus.Submitted]: { label: "Menunggu Verifikasi", tone: "warning" },
  [ClaimStatus.Approved]: { label: "Disetujui Verifikator", tone: "info" },
  [ClaimStatus.Rejected]: { label: "Ditolak", tone: "danger" },
  [ClaimStatus.Disputed]: { label: "Keberatan / Banding", tone: "danger" },
  [ClaimStatus.Settled]: { label: "Diselesaikan", tone: "success" },
  [ClaimStatus.Withdrawn]: { label: "Ditarik", tone: "neutral" },
};

export const defaultTypeLabel: Record<DefaultType, string> = {
  [DefaultType.None]: "-",
  [DefaultType.Partial]: "Default Sebagian",
  [DefaultType.Complete]: "Default Penuh",
};

export const recoveryStatusLabel: Record<RecoveryStatus, Label> = {
  [RecoveryStatus.Open]: { label: "Terbuka", tone: "info" },
  [RecoveryStatus.InRecovery]: { label: "Dalam Penagihan", tone: "warning" },
  [RecoveryStatus.PartiallyRecovered]: { label: "Pulih Sebagian", tone: "teal" },
  [RecoveryStatus.Recovered]: { label: "Pulih Penuh", tone: "success" },
  [RecoveryStatus.WrittenOff]: { label: "Dihapusbukukan", tone: "neutral" },
};

export const ROLE_LABELS = {
  admin: "Administrator Platform",
  registrar: "Registrar Kontrak",
  buyer: "Pembeli / Manufaktur",
  provider: "Penyedia Proteksi",
  verifier: "Verifikator Independen",
} as const;

export type RoleKey = keyof typeof ROLE_LABELS;

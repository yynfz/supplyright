import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { QTY_DECIMALS } from "@/lib/protocol/types";

export const TOKEN_SYMBOL = "mETH";
export const TOKEN_DECIMALS = 18;

const idNumber = (maxFraction: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: maxFraction });

/** 16000000000000000000n -> "16 mETH" */
export function formatToken(value: bigint | undefined | null, opts: { symbol?: boolean; digits?: number } = {}) {
  if (value === undefined || value === null) return "-";
  const n = Number(formatUnits(value, TOKEN_DECIMALS));
  const s = idNumber(opts.digits ?? 4).format(n);
  return opts.symbol === false ? s : `${s} ${TOKEN_SYMBOL}`;
}

export function parseToken(input: string): bigint {
  return parseUnits(input.replace(",", ".").trim() || "0", TOKEN_DECIMALS);
}

/** 50000n -> "50 MT" */
export function formatQty(value: bigint | undefined | null, unit = "MT") {
  if (value === undefined || value === null) return "-";
  const n = Number(formatUnits(value, QTY_DECIMALS));
  return `${idNumber(3).format(n)} ${unit}`.trim();
}

export function parseQty(input: string): bigint {
  return parseUnits(input.replace(",", ".").trim() || "0", QTY_DECIMALS);
}

export function formatBps(bps: number) {
  return `${idNumber(2).format(bps / 100)}%`;
}

export function formatPercent(ratio: number) {
  return `${idNumber(1).format(ratio * 100)}%`;
}

export function shortAddress(a?: Address | string | null) {
  if (!a) return "-";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h?: Hex | string | null) {
  if (!h || /^0x0+$/.test(h)) return "-";
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export function isZeroHash(h?: string | null) {
  return !h || /^0x0*$/.test(h);
}

export function isZeroAddress(a?: string | null) {
  return !a || /^0x0{40}$/i.test(a);
}

const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(unixSeconds?: number | null) {
  if (!unixSeconds) return "-";
  return dateFmt.format(new Date(unixSeconds * 1000));
}

export function formatDateTime(unixSeconds?: number | null) {
  if (!unixSeconds) return "-";
  return dateTimeFmt.format(new Date(unixSeconds * 1000));
}

/** Human relative time against a reference "now" (chain time when available). */
export function formatRelative(unixSeconds: number, nowSeconds: number) {
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86400, "hari"],
    [3600, "jam"],
    [60, "menit"],
  ];
  for (const [secs, label] of units) {
    if (abs >= secs) {
      const v = Math.floor(abs / secs);
      return diff >= 0 ? `${v} ${label} lagi` : `${v} ${label} lalu`;
    }
  }
  return diff >= 0 ? "kurang dari 1 menit lagi" : "baru saja";
}

export function formatDuration(seconds: number) {
  if (seconds <= 0) return "0";
  if (seconds % 86400 === 0) return `${seconds / 86400} hari`;
  if (seconds % 3600 === 0) return `${seconds / 3600} jam`;
  if (seconds % 60 === 0) return `${seconds / 60} menit`;
  return `${seconds} detik`;
}

import { parseUnits } from "viem";

/** Validate precision before parseUnits, which otherwise rounds excess decimals. */
export function exactPositiveDecimal(input: string, decimals: number, label: string): { text: string; value: bigint } {
  const text = input.trim().replace(",", ".");
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text)) {
    throw new Error(`${label} harus angka positif dengan maksimal ${decimals} angka desimal. Gunakan titik atau koma tanpa pemisah ribuan.`);
  }
  const value = parseUnits(text, decimals);
  if (value <= 0n) throw new Error(`${label} harus lebih besar dari nol.`);
  if (value > (1n << 256n) - 1n) throw new Error(`${label} terlalu besar untuk disimpan onchain.`);
  return { text, value };
}

export function validUnit(input: string): string {
  const unit = input.trim();
  if (!/^[\x20-\x7E]{1,8}$/.test(unit)) throw new Error("Satuan harus 1–8 karakter ASCII (contoh: MT, KG, pcs).");
  return unit;
}

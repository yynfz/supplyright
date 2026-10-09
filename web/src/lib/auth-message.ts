/** Message a wallet signs to prove ownership before accessing private offchain data. No gas, no tx. */
export function buildAuthMessage(address: string, issuedAt: string) {
  return [
    "SupplyRight - akses data privat",
    "",
    "Dengan menandatangani pesan ini Anda membuktikan kepemilikan wallet.",
    "Ini bukan transaksi dan tidak memerlukan biaya.",
    "",
    `Alamat: ${address}`,
    `Diterbitkan: ${issuedAt}`,
  ].join("\n");
}

export const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export { exactPositiveDecimal, validUnit } from "@/lib/commercial-validation";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
}

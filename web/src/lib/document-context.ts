export type DocumentContext = { kind: "claim" | "request" | "supply" | "protection" | "recovery"; chainId: number; id: bigint };

/** Private evidence contexts must identify a real entity on the caller's active chain. */
export function parseDocumentContext(value: string, callerChainId: number): DocumentContext | null {
  const match = /^(claim|request|supply|protection|recovery):([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const chainId = Number(match[2]);
  if (!Number.isSafeInteger(chainId) || chainId !== callerChainId) return null;
  const id = BigInt(match[3]);
  if (id > (1n << 256n) - 1n) return null;
  return { kind: match[1] as DocumentContext["kind"], chainId, id };
}

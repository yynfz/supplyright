/** Contract page functions use consecutive, one-based IDs. Never silently truncate financial state. */
export async function readProtocolPages<T>(read: (fromId: bigint, count: bigint) => Promise<readonly T[]>, pageSize = 100n): Promise<T[]> {
  if (pageSize <= 0n || pageSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Ukuran halaman tidak valid.");
  const result: T[] = [];
  for (let fromId = 1n; ; fromId += pageSize) {
    const page = await read(fromId, pageSize);
    if (BigInt(page.length) > pageSize) throw new Error("Kontrak mengembalikan halaman yang tidak valid.");
    result.push(...page);
    if (BigInt(page.length) < pageSize) return result;
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { readProtocolPages } from "../src/lib/protocol/pagination";

function contractPages(total: number) {
  const calls: [bigint, bigint][] = [];
  const records = Array.from({ length: total }, (_, i) => ({ id: i + 1, paidAmount: BigInt(i + 1) }));
  const read = async (fromId: bigint, count: bigint) => {
    calls.push([fromId, count]);
    return Object.freeze(records.slice(Number(fromId - 1n), Number(fromId - 1n + count)));
  };
  return { records, calls, read };
}

test("preserves all financial records beyond the former 500-record boundary", async () => {
  const source = contractPages(1207);
  const records = await readProtocolPages(source.read, 500n);
  assert.deepEqual(records, source.records);
  assert.deepEqual(source.calls, [[1n, 500n], [501n, 500n], [1001n, 500n]]);
  assert.equal(records.reduce((sum, record) => sum + record.paidAmount, 0n), 1207n * 1208n / 2n);
});

test("default page size includes record 501 without overlap or omitted IDs", async () => {
  const source = contractPages(501);
  const records = await readProtocolPages(source.read);
  assert.equal(records.length, 501);
  assert.equal(records.at(-1)?.id, 501);
  assert.equal(new Set(records.map((record) => record.id)).size, 501);
  assert.deepEqual(source.calls.map(([fromId]) => fromId), [1n, 101n, 201n, 301n, 401n, 501n]);
});

test("exact page multiples stop after the following empty page", async () => {
  const source = contractPages(1000);
  assert.equal((await readProtocolPages(source.read, 500n)).length, 1000);
  assert.deepEqual(source.calls, [[1n, 500n], [501n, 500n], [1001n, 500n]]);
});

test("empty deployment produces an empty snapshot after one RPC read", async () => {
  const source = contractPages(0);
  assert.deepEqual(await readProtocolPages(source.read, 500n), []);
  assert.deepEqual(source.calls, [[1n, 500n]]);
});

test("later-page RPC failure rejects rather than returning misleading partial totals", async () => {
  const source = contractPages(600);
  const failure = new Error("RPC unavailable on page two");
  await assert.rejects(readProtocolPages(async (fromId, count) => {
    if (fromId === 501n) throw failure;
    return source.read(fromId, count);
  }, 500n), (error: unknown) => error === failure);
});

test("initial RPC failures are propagated without fabricating an empty deployment", async () => {
  const failure = new Error("Contract deployment cannot be read");
  await assert.rejects(readProtocolPages(async () => { throw failure; }), (error: unknown) => error === failure);
});

test("invalid page sizes fail before sending any RPC read", async () => {
  for (const size of [0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    let invoked = false;
    await assert.rejects(readProtocolPages(async () => { invoked = true; return []; }, size), /Ukuran halaman tidak valid/);
    assert.equal(invoked, false);
  }
});

test("oversized contract responses are rejected instead of shifting page ID boundaries", async () => {
  await assert.rejects(readProtocolPages(async () => [1, 2, 3], 2n), /halaman yang tidak valid/);
});

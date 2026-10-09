import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseDocumentContext } from "../src/lib/document-context";

test("all participant evidence contexts preserve exact onchain IDs", () => {
  for (const kind of ["claim", "request", "supply", "protection", "recovery"]) {
    assert.deepEqual(parseDocumentContext(kind + ":31337:9007199254740993", 31337), { kind, chainId: 31337, id: 9007199254740993n });
  }
});
test("evidence from another chain cannot be authorized with the caller's current roles", () => {
  assert.equal(parseDocumentContext("claim:11155111:1", 31337), null);
  assert.equal(parseDocumentContext("supply:31337:1", 11155111), null);
});
test("malformed or ambiguous contexts fail closed before RPC", () => {
  for (const context of ["claim:31337:0", "claim:31337:-1", "claim:31337:1:extra", "claim:031337:1", "claim:31337:01", "claim:31337:1.5", "other:31337:1", "claim:31337:0x1", "claim:31337:1\n"]) {
    assert.equal(parseDocumentContext(context, 31337), null, context);
  }
});
test("IDs must fit uint256; maximum valid ID is retained", () => {
  const max = (1n << 256n) - 1n;
  assert.equal(parseDocumentContext("recovery:31337:" + max, 31337)?.id, max);
  assert.equal(parseDocumentContext("recovery:31337:" + (max + 1n), 31337), null);
});

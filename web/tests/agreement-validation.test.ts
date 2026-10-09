import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits } from "viem";
import { ZodError } from "zod";
import { createAgreementSchema, requireAgreementDocumentKinds } from "../src/lib/agreement-validation";

const payload = {
  buyerAddress: "0x1111111111111111111111111111111111111111",
  buyerName: "PT Pembeli",
  supplierName: "PT Pemasok",
  supplierRef: "SUP-001",
  materialName: "Baja",
  materialCode: "STEEL-001",
  quantity: "50.125",
  unit: "MT",
  contractValue: "16.000000000000000001",
  deliveryDeadline: "2030-10-09T12:00:00.000Z",
  poNumber: "PO-001",
  poDocumentId: "10000000-0000-4000-8000-000000000001",
  agreementDocumentId: "10000000-0000-4000-8000-000000000002",
  supplierAckDocumentId: "10000000-0000-4000-8000-000000000003",
};

const documents = [
  { id: payload.poDocumentId, kind: "PURCHASE_ORDER" },
  { id: payload.agreementDocumentId, kind: "SUPPLY_AGREEMENT" },
  { id: payload.supplierAckDocumentId, kind: "SUPPLIER_ACK" },
];

function rejectsField(field: keyof typeof payload, value: unknown) {
  const result = createAgreementSchema.safeParse({ ...payload, [field]: value });
  assert.equal(result.success, false, `${field}: ${String(value)}`);
  if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === field));
}

test("the API accepts a complete mintable payload without losing exact mETH decimals", () => {
  const accepted = createAgreementSchema.parse(payload);
  assert.equal(accepted.contractValue, "16.000000000000000001");
  assert.equal(accepted.quantity, "50.125");
  assert.doesNotThrow(() => requireAgreementDocumentKinds(accepted, documents));
});

test("direct API clients cannot create zero or excess-precision economic records", () => {
  for (const value of ["0", "0.000", "0.0009", "50.1259", "50.0000"]) rejectsField("quantity", value);
  for (const value of ["0", "0.000000000000000000", "0.0000000000000000009", "16.1234567890123456789"]) rejectsField("contractValue", value);
  assert.equal(createAgreementSchema.parse({ ...payload, quantity: "0.001", contractValue: "0.000000000000000001" }).quantity, "0.001");
});

test("the API checks uint256 bounds on the scaled value instead of the human decimal string", () => {
  const maximum = (1n << 256n) - 1n;
  for (const [field, decimals] of [["quantity", 3], ["contractValue", 18]] as const) {
    assert.equal(createAgreementSchema.parse({ ...payload, [field]: formatUnits(maximum, decimals) })[field], formatUnits(maximum, decimals));
    rejectsField(field, formatUnits(maximum + 1n, decimals));
  }
});

test("economic payloads require canonical decimal strings, preventing locale or exponent ambiguity", () => {
  for (const field of ["quantity", "contractValue"] as const) {
    for (const value of [-1, 16, "-1", "+1", "1e18", "NaN", "Infinity", "1,000", "1.000,50", "1 000", ".5", "5.", " 16 "]) rejectsField(field, value);
  }
});

test("unit validation uses printable ASCII bytes rather than JavaScript character length", () => {
  assert.equal(createAgreementSchema.parse({ ...payload, unit: "TONNE123" }).unit, "TONNE123");
  assert.equal(createAgreementSchema.parse({ ...payload, unit: "m^3" }).unit, "m^3");
  for (const value of ["", "        ", "TONNE1234", "kg_日本", "📦📦", "éééé", "MT\0", "MT\n", "\tMT"]) rejectsField("unit", value);
});

test("wrong document kinds cannot be substituted for PO, supply agreement, or supplier acknowledgement", () => {
  for (const [index, field] of [[0, "poDocumentId"], [1, "agreementDocumentId"], [2, "supplierAckDocumentId"]] as const) {
    const substituted = documents.map((document, position) => position === index ? { ...document, kind: "CLAIM_EVIDENCE" } : document);
    assert.throws(() => requireAgreementDocumentKinds(payload, substituted), (error: unknown) => {
      assert.ok(error instanceof ZodError);
      assert.ok(error.issues.some((issue) => issue.path[0] === field));
      return true;
    });
  }
  assert.throws(() => requireAgreementDocumentKinds({ ...payload, poDocumentId: payload.agreementDocumentId, agreementDocumentId: payload.poDocumentId }, documents), ZodError);
});

test("an acknowledgement is optional, but a supplied ID must resolve to the correct uploaded file", () => {
  const withoutAck = { poDocumentId: payload.poDocumentId, agreementDocumentId: payload.agreementDocumentId };
  assert.doesNotThrow(() => requireAgreementDocumentKinds(withoutAck, documents.slice(0, 2)));
  assert.throws(() => requireAgreementDocumentKinds(payload, documents.slice(0, 2)), ZodError);
  assert.throws(() => requireAgreementDocumentKinds({ ...withoutAck, supplierAckDocumentId: payload.poDocumentId }, documents), ZodError);
});

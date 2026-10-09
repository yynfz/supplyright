import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits, stringToHex } from "viem";
import { exactPositiveDecimal, validUnit } from "../src/app/(app)/registry/registry-utils";

test("mETH values retain all 18 decimals and decimal commas are normalized before submission", () => {
  assert.deepEqual(exactPositiveDecimal(" 16,000000000000000001 ", 18, "Nilai kontrak"), {
    text: "16.000000000000000001",
    value: 16_000_000_000_000_000_001n,
  });
  assert.equal(exactPositiveDecimal("0.000000000000000001", 18, "Nilai kontrak").value, 1n);
});

test("sub-wei and excess-precision amounts cannot round into a different onchain contract value", () => {
  for (const amount of ["0.0000000000000000009", "10.1234567890123456789", "1.0000000000000000000"]) {
    assert.throws(() => exactPositiveDecimal(amount, 18, "Nilai kontrak"), /maksimal 18/, amount);
  }
});

test("quantities distinguish the minimum deliverable increment from values that would round up", () => {
  assert.equal(exactPositiveDecimal("0.001", 3, "Kuantitas").value, 1n);
  assert.equal(exactPositiveDecimal("50.125", 3, "Kuantitas").value, 50_125n);
  for (const amount of ["0.0009", "49.9999", "50.0000"]) {
    assert.throws(() => exactPositiveDecimal(amount, 3, "Kuantitas"), /maksimal 3/, amount);
  }
});

test("zero, signed numbers, exponent notation, and grouping separators cannot become economic amounts", () => {
  for (const amount of ["0", "000", "0.000", "0,000", " 0 "]) {
    assert.throws(() => exactPositiveDecimal(amount, 18, "Nilai kontrak"), /lebih besar dari nol/, amount);
  }
  for (const amount of ["", " ", "-1", "+1", "1e18", "Infinity", "NaN", ".5", "5.", "1 000", "1,000,000", "1.000,50", "1\n2"]) {
    assert.throws(() => exactPositiveDecimal(amount, 18, "Nilai kontrak"), /harus angka positif/, amount);
  }
});

test("uint256 limits are checked after scaling for both mETH and quantities", () => {
  const maximum = (1n << 256n) - 1n;
  for (const decimals of [18, 3]) {
    assert.equal(exactPositiveDecimal(formatUnits(maximum, decimals), decimals, "Nilai").value, maximum);
    assert.throws(() => exactPositiveDecimal(formatUnits(maximum + 1n, decimals), decimals, "Nilai"), /terlalu besar/);
  }
});

test("ASCII units fit the exact bytes8 ABI boundary without truncation", () => {
  assert.equal(validUnit(" MT "), "MT");
  assert.equal(validUnit("kg/m3"), "kg/m3");
  assert.equal(stringToHex(validUnit("TONNE123"), { size: 8 }), "0x544f4e4e45313233");
  assert.throws(() => validUnit("TONNE1234"), /1–8 karakter ASCII/);
});

test("UTF-8 units and control characters cannot bypass the conservative ASCII bytes8 policy", () => {
  // JS character counts do not represent UTF-8 byte counts; nine bytes would overflow bytes8.
  assert.equal(new TextEncoder().encode("kg_日本").length, 9);
  for (const unit of ["", "   ", "kg_日本", "éééé", "📦📦", "MT\0", "M\nT"]) {
    assert.throws(() => validUnit(unit), /1–8 karakter ASCII/, JSON.stringify(unit));
  }
});

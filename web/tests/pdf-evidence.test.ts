import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateEvidencePdf } from "../src/lib/pdf";

test("generates a valid, parseable PDF for text evidence", async () => {
  const sampleEvidence = [
    "=== DATA DEMO FIKTIF ===",
    "BUNDEL BUKTI KLAIM PO-2026-0417",
    "1. DN-0417-01: hanya 10 MT diterima sebelum batas waktu.",
    "2. Laporan gudang: tidak ada penerimaan tambahan setelah batas waktu.",
    "3. Korespondensi: pemasok tidak memberikan jadwal pengiriman baru.",
    "4. Dampak: Modul Baterai EV-48V tidak dapat diproduksi.",
    "Kerugian yang diklaim: nilai 40 MT yang tidak terkirim = 0,04 ETH.",
  ].join("\n");

  const pdfBytes = await generateEvidencePdf({
    fileName: "CLAIM-EVIDENCE-0417.txt",
    kind: "CLAIM_EVIDENCE",
    sha256: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    uploadedBy: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    contextKey: "claim:31337:1",
    createdAt: new Date().toISOString(),
    textContent: sampleEvidence,
  });

  assert.ok(pdfBytes.length > 500, "PDF should have substantial length");

  // PDF magic bytes: %PDF-
  const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
  assert.equal(header, "%PDF-");

  // Load and verify PDF structure
  const loadedDoc = await PDFDocument.load(pdfBytes);
  assert.equal(loadedDoc.getTitle(), "SupplyRight Evidence - CLAIM-EVIDENCE-0417.txt");
  assert.equal(loadedDoc.getAuthor(), "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  assert.ok(loadedDoc.getPageCount() >= 1, "Should have at least 1 page");
});

test("handles long multi-page text evidence and sanitizes unicode characters", async () => {
  // Generate 150 lines with various unicode characters
  const longLines = Array.from({ length: 150 }, (_, i) =>
    `Baris #${i + 1}: Bukti audit komersial — klaim terverifikasi • "Catatan penting" … ${i * 10} unit material.`
  );

  const pdfBytes = await generateEvidencePdf({
    fileName: "EVIDENCE-LONG-REPORT.txt",
    kind: "CLAIM_EVIDENCE",
    sha256: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    uploadedBy: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    contextKey: "claim:31337:2",
    textContent: longLines.join("\n"),
  });

  const loadedDoc = await PDFDocument.load(pdfBytes);
  assert.ok(loadedDoc.getPageCount() > 1, "Long text evidence should span multiple pages");
});

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/offchain-types";

export type EvidencePdfParams = {
  fileName: string;
  kind?: DocumentKind | string;
  sha256: string;
  uploadedBy?: string;
  contextKey?: string | null;
  createdAt?: string;
  textContent: string;
};

function sanitizeForPdf(str: string): string {
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, "?");
}

function wrapLine(line: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = line.split(" ");
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) wrapped.push(current);
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let part = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(part + char, fontSize) <= maxWidth) {
            part += char;
          } else {
            if (part) wrapped.push(part);
            part = char;
          }
        }
        current = part;
      } else {
        current = word;
      }
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [""];
}

export async function generateEvidencePdf(params: EvidencePdfParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`SupplyRight Evidence - ${params.fileName}`);
  pdfDoc.setAuthor(params.uploadedBy || "SupplyRight Protocol");
  pdfDoc.setSubject(`Evidence document: ${params.sha256}`);
  pdfDoc.setCreator("SupplyRight Protocol (https://supplyright.io)");

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 48;
  const marginTop = 50;
  const marginBottom = 50;
  const contentWidth = pageWidth - marginX * 2;

  const navyColor = rgb(0.06, 0.12, 0.22);
  const tealColor = rgb(0.05, 0.6, 0.55);
  const slateColor = rgb(0.3, 0.35, 0.42);
  const lightBg = rgb(0.96, 0.97, 0.98);
  const borderColor = rgb(0.85, 0.88, 0.92);

  // Split text content into wrapped lines
  const rawLines = sanitizeForPdf(params.textContent).split(/\r?\n/);
  const bodyLines: string[] = [];
  for (const raw of rawLines) {
    if (!raw.trim()) {
      bodyLines.push("");
    } else {
      const wrapped = wrapLine(raw, fontMono, 9.5, contentWidth);
      bodyLines.push(...wrapped);
    }
  }

  // Create first page
  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginTop;

  // Header Banner
  currentPage.drawText("SupplyRight", { x: marginX, y, size: 20, font: fontBold, color: navyColor });
  currentPage.drawText(".", { x: marginX + fontBold.widthOfTextAtSize("SupplyRight", 20), y, size: 20, font: fontBold, color: tealColor });

  const badgeText = "ONCHAIN VERIFIED EVIDENCE";
  const badgeWidth = fontBold.widthOfTextAtSize(badgeText, 8) + 16;
  const badgeHeight = 18;
  const badgeX = pageWidth - marginX - badgeWidth;
  const badgeY = y - 2;

  currentPage.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeWidth,
    height: badgeHeight,
    color: rgb(0.92, 0.98, 0.97),
    borderColor: tealColor,
    borderWidth: 1,
  });
  currentPage.drawText(badgeText, { x: badgeX + 8, y: badgeY + 5, size: 8, font: fontBold, color: tealColor });

  y -= 14;
  currentPage.drawText("Verified Commercial Assurance & Digital Evidence Record", {
    x: marginX,
    y,
    size: 9,
    font: fontRegular,
    color: slateColor,
  });

  y -= 24;
  const kindLabel = (params.kind && DOCUMENT_KIND_LABEL[params.kind as DocumentKind]) || params.kind || "Dokumen Bukti";
  currentPage.drawText(sanitizeForPdf(kindLabel.toUpperCase()), {
    x: marginX,
    y,
    size: 14,
    font: fontBold,
    color: navyColor,
  });

  // Metadata Card
  y -= 12;
  const metaBoxHeight = 88;
  const metaBoxY = y - metaBoxHeight;

  currentPage.drawRectangle({
    x: marginX,
    y: metaBoxY,
    width: contentWidth,
    height: metaBoxHeight,
    color: lightBg,
    borderColor,
    borderWidth: 1,
  });

  const metaRows = [
    { label: "Nama File", value: params.fileName, mono: false },
    { label: "SHA-256 Digest", value: params.sha256, mono: true },
    { label: "Penulis (Wallet)", value: params.uploadedBy || "Tidak tercatat", mono: true },
    { label: "Konteks Protokol", value: params.contextKey || "-", mono: true },
    { label: "Waktu Ekspor", value: params.createdAt || new Date().toISOString(), mono: false },
  ];

  let metaY = y - 16;
  for (const row of metaRows) {
    currentPage.drawText(row.label + ":", { x: marginX + 12, y: metaY, size: 8.5, font: fontBold, color: slateColor });
    const valFont = row.mono ? fontMono : fontRegular;
    currentPage.drawText(sanitizeForPdf(row.value), { x: marginX + 120, y: metaY, size: 8.5, font: valFont, color: navyColor });
    metaY -= 15;
  }

  y = metaBoxY - 24;

  currentPage.drawText("Isi Bukti (Evidence Content)", {
    x: marginX,
    y,
    size: 11,
    font: fontBold,
    color: navyColor,
  });

  y -= 8;
  currentPage.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 18;
  const lineHeight = 13;

  for (const line of bodyLines) {
    if (y < marginBottom + 30) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginTop;

      // Small header on subsequent pages
      currentPage.drawText(`SupplyRight - ${params.fileName} (lanjutan)`, {
        x: marginX,
        y,
        size: 8.5,
        font: fontRegular,
        color: slateColor,
      });
      y -= 6;
      currentPage.drawLine({
        start: { x: marginX, y },
        end: { x: pageWidth - marginX, y },
        thickness: 0.5,
        color: borderColor,
      });
      y -= 18;
    }

    if (line) {
      currentPage.drawText(line, {
        x: marginX,
        y,
        size: 9,
        font: fontMono,
        color: navyColor,
      });
    }
    y -= lineHeight;
  }

  // Draw footers on all pages
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    const footerY = marginBottom - 12;

    page.drawLine({
      start: { x: marginX, y: footerY + 16 },
      end: { x: pageWidth - marginX, y: footerY + 16 },
      thickness: 0.5,
      color: borderColor,
    });

    page.drawText("SupplyRight Protocol - Catatan Bukti Digital Terverifikasi", {
      x: marginX,
      y: footerY,
      size: 7.5,
      font: fontRegular,
      color: slateColor,
    });

    const pageStr = `Halaman ${i + 1} dari ${totalPages}`;
    const pageStrWidth = fontRegular.widthOfTextAtSize(pageStr, 7.5);
    page.drawText(pageStr, {
      x: pageWidth - marginX - pageStrWidth,
      y: footerY,
      size: 7.5,
      font: fontRegular,
      color: slateColor,
    });
  }

  return await pdfDoc.save();
}


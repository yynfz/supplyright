import { z } from "zod";
import { exactPositiveDecimal, validUnit } from "./commercial-validation";

function positiveAmount(decimals: number, label: string) {
  return z.string().regex(/^\d+(?:\.\d+)?$/, "Gunakan angka desimal dengan titik tanpa pemisah ribuan.").transform((input, context) => {
    try {
      return exactPositiveDecimal(input, decimals, label).text;
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : `${label} tidak valid.` });
      return z.NEVER;
    }
  });
}

const unit = z.string().regex(/^[\x20-\x7E]{1,8}$/, "Satuan harus 1–8 karakter ASCII printable.").transform((input, context) => {
  try {
    return validUnit(input);
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Satuan tidak valid." });
    return z.NEVER;
  }
});

/** The API accepts normalized decimal strings; precision and range match the NFT's uint256 fields. */
export const createAgreementSchema = z.object({
  buyerAddress: z.string().optional(),
  buyerName: z.string().min(2).max(160),
  supplierName: z.string().min(2).max(160),
  supplierRef: z.string().min(2).max(80),
  materialName: z.string().min(2).max(160),
  materialCode: z.string().min(2).max(40),
  quantity: positiveAmount(3, "Kuantitas"),
  unit: unit.default("MT"),
  contractValue: positiveAmount(18, "Nilai kontrak"),
  deliveryDeadline: z.string().datetime(),
  poNumber: z.string().min(2).max(60),
  incoterms: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  poDocumentId: z.string().uuid(),
  agreementDocumentId: z.string().uuid(),
  supplierAckDocumentId: z.string().uuid().optional(),
});

type AgreementDocumentIds = Pick<z.infer<typeof createAgreementSchema>, "poDocumentId" | "agreementDocumentId" | "supplierAckDocumentId">;

/** A valid uploaded file cannot be substituted for a different required commercial document type. */
export function requireAgreementDocumentKinds(input: AgreementDocumentIds, documents: readonly { id: string; kind: string }[]): void {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const expected = [
    ["poDocumentId", "PURCHASE_ORDER"],
    ["agreementDocumentId", "SUPPLY_AGREEMENT"],
    ["supplierAckDocumentId", "SUPPLIER_ACK"],
  ] as const;
  const issues: z.ZodIssue[] = [];
  for (const [field, kind] of expected) {
    const id = input[field];
    if (!id) continue;
    const document = byId.get(id);
    if (!document || document.kind !== kind) {
      issues.push({ code: z.ZodIssueCode.custom, path: [field], message: `Dokumen harus berjenis ${kind}.` });
    }
  }
  if (issues.length) throw new z.ZodError(issues);
}

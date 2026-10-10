/** Rows of the private Supabase tables (see supabase/migrations). Amounts are decimal strings in ETH (native, 18 decimals). */

export type AgreementStatus = "SUBMITTED" | "VERIFIED" | "MINTED" | "REJECTED";

export type Agreement = {
  id: string;
  chain_id: number;
  token_id: number | null;
  status: AgreementStatus;
  buyer_address: string;
  buyer_name: string;
  supplier_name: string;
  supplier_ref: string;
  supplier_ref_hash: string;
  material_name: string;
  material_code: string;
  quantity: string;
  unit: string;
  contract_value: string;
  delivery_deadline: string;
  po_number: string;
  incoterms: string | null;
  notes: string | null;
  po_hash: string;
  agreement_hash: string;
  supplier_ack_hash: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  mint_tx_hash: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const DOCUMENT_KINDS = [
  "PURCHASE_ORDER",
  "SUPPLY_AGREEMENT",
  "SUPPLIER_REFERENCE",
  "SUPPLIER_ACK",
  "DELIVERY_NOTE",
  "PROTECTION_TERMS",
  "UNDERWRITING_MEMO",
  "CLAIM_EVIDENCE",
  "VERIFIER_REPORT",
  "REJECTION_REPORT",
  "OBJECTION",
  "RECOVERY_UPDATE",
  "CLOSING_MEMO",
  "OTHER",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  PURCHASE_ORDER: "Purchase Order",
  SUPPLY_AGREEMENT: "Perjanjian Pasokan",
  SUPPLIER_REFERENCE: "Referensi Pemasok (salted)",
  SUPPLIER_ACK: "Konfirmasi Pemasok",
  DELIVERY_NOTE: "Delivery Note",
  PROTECTION_TERMS: "Syarat Proteksi",
  UNDERWRITING_MEMO: "Memo Underwriting",
  CLAIM_EVIDENCE: "Bukti Klaim",
  VERIFIER_REPORT: "Laporan Verifikator",
  REJECTION_REPORT: "Alasan Penolakan",
  OBJECTION: "Keberatan / Banding",
  RECOVERY_UPDATE: "Update Pemulihan",
  CLOSING_MEMO: "Memo Penutupan",
  OTHER: "Lainnya",
};

export type StoredDocument = {
  id: string;
  agreement_id: string | null;
  context_key: string | null;
  kind: DocumentKind;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: `0x${string}`;
  uploaded_by: string;
  created_at: string;
};

export type Criticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ReportedStatus = "ON_TRACK" | "REPORTED_DELAY" | "ARRIVED";

export type Material = {
  id: string;
  name: string;
  code: string;
  criticality: Criticality;
  agreement_id: string | null;
  po_hash: string | null;
  reported_status: ReportedStatus | null;
  alternative_suppliers: number;
  alternative_lead_days: number | null;
  notes: string | null;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  daily_output_units: number | null;
  notes: string | null;
};

export type Dependency = {
  id: string;
  material_id: string;
  product_id: string;
  is_blocking: boolean;
  est_disruption_days: number;
  est_financial_exposure: string;
  notes: string | null;
};

export type ProductionMap = { materials: Material[]; products: Product[]; dependencies: Dependency[] };

/** Context keys tie documents to onchain entities: e.g. "claim:31337:1", "request:31337:2". */
export const contextKey = (kind: "claim" | "request" | "protection" | "recovery" | "supply", chainId: number, id: number) =>
  `${kind}:${chainId}:${id}`;

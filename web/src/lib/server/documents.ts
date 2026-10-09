import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Address } from "viem";
import { claimManagerAbi, vaultAbi, supplyRightNftAbi, recoveryClaimNftAbi } from "@/generated/abis";
import { parseDocumentContext } from "@/lib/document-context";
import type { DocumentKind, StoredDocument } from "@/lib/offchain-types";
import type { Caller } from "./auth";
import { serverClient } from "./auth";
import { getDeployment } from "./deployments";
import { HttpError, dbError } from "./http";
import { DOCUMENT_BUCKET, supabaseAdmin } from "./supabase";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const DOC_COLUMNS =
  "id, agreement_id, context_key, kind, file_name, mime_type, size_bytes, sha256, uploaded_by, created_at";

export function sha256Hex(bytes: Uint8Array | Buffer): `0x${string}` {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "document";
}

/** Store bytes in the private bucket and record metadata. The sha256 is what goes onchain. */
export async function storeDocument(params: {
  caller: Caller;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  kind: DocumentKind;
  agreementId?: string | null;
  contextKey?: string | null;
}): Promise<StoredDocument> {
  if (params.bytes.byteLength === 0) throw new HttpError(400, "Dokumen kosong.");
  if (params.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Ukuran dokumen maksimal 10 MB.");
  const sb = supabaseAdmin();
  const sha256 = sha256Hex(params.bytes);
  const path = `${params.caller.chainId}/${params.kind.toLowerCase()}/${sha256.slice(2, 14)}-${randomUUID()}-${sanitize(params.fileName)}`;

  const { error: upErr } = await sb.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, params.bytes, { contentType: params.mimeType || "application/octet-stream", upsert: false });
  if (upErr) {
    console.error("[storage] upload", upErr.message);
    throw new HttpError(500, "Gagal menyimpan dokumen ke storage privat.");
  }

  const { data, error } = await sb
    .from("documents")
    .insert({
      agreement_id: params.agreementId ?? null,
      context_key: params.contextKey ?? null,
      kind: params.kind,
      file_name: params.fileName,
      mime_type: params.mimeType || "application/octet-stream",
      size_bytes: params.bytes.byteLength,
      sha256,
      storage_path: path,
      uploaded_by: params.caller.address.toLowerCase(),
    })
    .select(DOC_COLUMNS)
    .single();
  dbError(error, "mencatat metadata dokumen");
  return data as StoredDocument;
}

/**
 * Document access policy:
 *  - uploader, admin, registrar, verifier, provider: allowed
 *  - buyer: own agreement or onchain supply/protection/claim/request/recovery party
 *  - associated agreements and contexts must belong to the caller's active chain
 */
export async function canAccessDocument(
  caller: Caller,
  doc: { uploaded_by: string; agreement_id: string | null; context_key: string | null },
): Promise<boolean> {
  const me = caller.address.toLowerCase();
  const r = caller.roles;
  const context = doc.context_key ? parseDocumentContext(doc.context_key, caller.chainId) : null;
  if (doc.context_key && !context) return false;
  let ownAgreement = false;
  if (doc.agreement_id) {
    const { data, error } = await supabaseAdmin().from("agreements").select("buyer_address, chain_id").eq("id", doc.agreement_id).single();
    dbError(error, "memeriksa akses dokumen");
    if (!data || data.chain_id !== caller.chainId) return false;
    ownAgreement = (data.buyer_address as string).toLowerCase() === me;
  }
  if (doc.uploaded_by.toLowerCase() === me || r.admin || r.registrar || r.verifier || r.provider) return true;
  if (!r.buyer) return false;
  if (ownAgreement) return true;
  if (context) {
    const { kind, chainId, id } = context;
    const d = getDeployment(chainId);
    if (!d) return false;
    const client = serverClient(chainId);
    if (kind === "claim") {
      const c = await client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "getClaim", args: [id] });
      return (c.claimant as Address).toLowerCase() === me;
    }
    if (kind === "request") {
      const q = await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getRequest", args: [id] });
      return (q.buyer as Address).toLowerCase() === me;
    }
    if (kind === "protection") {
      const p = await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getProtection", args: [id] });
      return p.beneficiary.toLowerCase() === me;
    }
    const supplyId = kind === "recovery"
      ? (await client.readContract({ address: d.recoveryClaimNFT, abi: recoveryClaimNftAbi, functionName: "getRecoveryClaim", args: [id] })).supplyRightId
      : id;
    const supply = await client.readContract({ address: d.supplyRightNFT, abi: supplyRightNftAbi, functionName: "getSupplyRight", args: [supplyId] });
    return supply.buyer.toLowerCase() === me;
  }
  return false;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { DOCUMENT_KINDS, type DocumentKind, type StoredDocument } from "@/lib/offchain-types";
import { requireCaller } from "@/lib/server/auth";
import { DOC_COLUMNS, canAccessDocument, storeDocument } from "@/lib/server/documents";
import { HttpError, dbError, handle } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Upload a private document (multipart: file, kind, agreementId?, contextKey?). Returns its SHA-256. */
export const POST = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "File wajib dilampirkan.");
  const kind = z.enum(DOCUMENT_KINDS).parse(form.get("kind")) as DocumentKind;
  const agreementId = (form.get("agreementId") as string) || null;
  const contextKey = (form.get("contextKey") as string) || null;
  const doc = await storeDocument({
    caller,
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    kind,
    agreementId,
    contextKey,
  });
  return NextResponse.json({ document: doc }, { status: 201 });
});

/** List document metadata by agreementId, contextKey, or sha256 (comma-separated). */
export const GET = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  const url = new URL(req.url);
  const agreementId = url.searchParams.get("agreementId");
  const contextKey = url.searchParams.get("contextKey");
  const contextPrefix = url.searchParams.get("contextPrefix");
  const hashes = url.searchParams.get("sha256");
  if (!agreementId && !contextKey && !contextPrefix && !hashes) {
    throw new HttpError(400, "Gunakan filter agreementId, contextKey, contextPrefix, atau sha256.");
  }
  let q = supabaseAdmin().from("documents").select(DOC_COLUMNS).order("created_at", { ascending: true }).limit(200);
  if (agreementId) q = q.eq("agreement_id", agreementId);
  if (contextKey) q = q.eq("context_key", contextKey);
  if (contextPrefix) q = q.like("context_key", `${contextPrefix}%`);
  if (hashes) q = q.in("sha256", hashes.split(",").map((h) => h.trim().toLowerCase()).slice(0, 100));
  const { data, error } = await q;
  dbError(error, "memuat dokumen");
  const visible: StoredDocument[] = [];
  for (const d of (data ?? []) as StoredDocument[]) {
    if (await canAccessDocument(caller, d)) visible.push(d);
  }
  return NextResponse.json({ documents: visible });
});

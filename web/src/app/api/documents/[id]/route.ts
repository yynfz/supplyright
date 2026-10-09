import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/server/auth";
import { canAccessDocument } from "@/lib/server/documents";
import { HttpError, handle } from "@/lib/server/http";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Returns a 60-second signed URL for an authorized caller. The bucket itself is private. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const caller = await requireCaller(req);
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: doc } = await sb
    .from("documents")
    .select("id, file_name, storage_path, uploaded_by, agreement_id, context_key, sha256")
    .eq("id", id)
    .single();
  if (!doc) throw new HttpError(404, "Dokumen tidak ditemukan.");
  if (!(await canAccessDocument(caller, doc))) throw new HttpError(403, "Anda tidak berhak mengakses dokumen ini.");
  const { data, error } = await sb.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) throw new HttpError(500, "Gagal membuat tautan unduhan.");
  return NextResponse.json({ url: data.signedUrl, fileName: doc.file_name, sha256: doc.sha256 });
});

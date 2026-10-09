import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/server/auth";
import { canAccessDocument } from "@/lib/server/documents";
import { HttpError, handle } from "@/lib/server/http";
import { generateEvidencePdf } from "@/lib/pdf";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * Downloads a private document for an authorized caller.
 * For text evidence documents, exports and formats them as a PDF.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const caller = await requireCaller(req);
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: doc } = await sb
    .from("documents")
    .select("id, file_name, storage_path, uploaded_by, agreement_id, context_key, sha256, mime_type, kind, created_at")
    .eq("id", id)
    .single();
  if (!doc) throw new HttpError(404, "Dokumen tidak ditemukan.");
  if (!(await canAccessDocument(caller, doc))) throw new HttpError(403, "Anda tidak berhak mengakses dokumen ini.");

  const isTextEvidence =
    doc.kind === "CLAIM_EVIDENCE" ||
    doc.file_name.toLowerCase().endsWith(".txt") ||
    doc.mime_type === "text/plain" ||
    doc.mime_type?.startsWith("text/");

  if (isTextEvidence) {
    const { data: fileBlob, error: dlError } = await sb.storage
      .from(DOCUMENT_BUCKET)
      .download(doc.storage_path);
    if (dlError || !fileBlob) throw new HttpError(500, "Gagal membaca isi bukti dokumen.");

    const textContent = await fileBlob.text();
    const pdfBytes = await generateEvidencePdf({
      fileName: doc.file_name,
      kind: doc.kind,
      sha256: doc.sha256,
      uploadedBy: doc.uploaded_by,
      contextKey: doc.context_key,
      createdAt: doc.created_at,
      textContent,
    });
    const pdfFileName = doc.file_name.replace(/\.[^/.]+$/, "") + ".pdf";
    const pdfBuffer = Buffer.from(pdfBytes);

    const url = new URL(req.url);
    if (
      url.searchParams.get("export") === "pdf" ||
      url.searchParams.get("download") === "pdf" ||
      req.headers.get("accept") === "application/pdf"
    ) {
      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFileName}"`,
          "Content-Length": String(pdfBuffer.length),
        },
      });
    }

    return NextResponse.json({
      url: "",
      fileName: pdfFileName,
      sha256: doc.sha256,
      isPdf: true,
      pdfBase64: pdfBuffer.toString("base64"),
    });
  }

  const { data, error } = await sb.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) throw new HttpError(500, "Gagal membuat tautan unduhan.");
  return NextResponse.json({ url: data.signedUrl, fileName: doc.file_name, sha256: doc.sha256, isPdf: false });
});

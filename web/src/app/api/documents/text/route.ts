import { NextResponse } from "next/server";
import { z } from "zod";
import { DOCUMENT_KINDS } from "@/lib/offchain-types";
import { requireCaller } from "@/lib/server/auth";
import { storeDocument } from "@/lib/server/documents";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().min(3).max(160),
  content: z.string().min(10).max(20_000),
  agreementId: z.string().uuid().optional(),
  contextKey: z.string().max(80).optional(),
});

/**
 * Turns a written statement (verifier report, rejection reason, underwriting memo, objection...) into a
 * private text document. Its SHA-256 is the decision hash the user then submits onchain, so the onchain
 * record is bound to exactly this text.
 */
export const POST = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  const body = Body.parse(await req.json());
  const text = [
    `SupplyRight - ${body.title}`,
    `Jenis: ${body.kind}`,
    `Penulis (wallet): ${caller.address}`,
    `Chain: ${caller.chainId}`,
    `Dibuat: ${new Date().toISOString()}`,
    "",
    body.content.trim(),
    "",
  ].join("\n");
  const fileName = `${body.kind.toLowerCase()}-${Date.now()}.txt`;
  const doc = await storeDocument({
    caller,
    bytes: new TextEncoder().encode(text),
    fileName,
    mimeType: "text/plain; charset=utf-8",
    kind: body.kind,
    agreementId: body.agreementId ?? null,
    contextKey: body.contextKey ?? null,
  });
  return NextResponse.json({ document: doc }, { status: 201 });
});

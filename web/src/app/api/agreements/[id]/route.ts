import { NextResponse } from "next/server";
import { z } from "zod";
import { supplyRightNftAbi } from "@/generated/abis";
import { canSeeAllAgreements, requireCaller, requireRole, serverClient, type Caller } from "@/lib/server/auth";
import { getDeployment } from "@/lib/server/deployments";
import { DOC_COLUMNS } from "@/lib/server/documents";
import { HttpError, dbError, handle } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

async function loadVisible(caller: Caller, id: string) {
  const { data, error } = await supabaseAdmin().from("agreements").select("*").eq("id", id).eq("chain_id", caller.chainId).maybeSingle();
  dbError(error, "memuat perjanjian");
  if (!data) throw new HttpError(404, "Perjanjian tidak ditemukan.");
  if (!canSeeAllAgreements(caller) && (data.buyer_address as string).toLowerCase() !== caller.address.toLowerCase()) {
    throw new HttpError(403, "Anda tidak berhak melihat perjanjian ini.");
  }
  return data;
}

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const caller = await requireCaller(req);
  const { id } = await ctx.params;
  const agreement = await loadVisible(caller, id);
  const { data: documents, error } = await supabaseAdmin()
    .from("documents")
    .select(DOC_COLUMNS)
    .eq("agreement_id", id)
    .order("created_at");
  dbError(error, "memuat dokumen");
  return NextResponse.json({ agreement, documents: documents ?? [] });
});

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), note: z.string().max(2000).optional() }),
  z.object({ action: z.literal("reject"), note: z.string().min(5).max(2000) }),
  z.object({ action: z.literal("sync"), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }),
]);

/**
 * verify / reject : registrar review of the submitted documents (offchain step before minting)
 * sync           : link the agreement to its minted Supply Right by reading tokenIdByPoRef onchain
 */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const caller = await requireCaller(req);
  const { id } = await ctx.params;
  const body = PatchBody.parse(await req.json());
  const agreement = await loadVisible(caller, id);
  const sb = supabaseAdmin();

  if (body.action === "verify" || body.action === "reject") {
    requireRole(caller, "registrar", "admin");
    if (agreement.status !== "SUBMITTED" && !(agreement.status === "VERIFIED" && body.action === "reject")) {
      throw new HttpError(409, `Perjanjian berstatus ${agreement.status}.`);
    }
    const { data, error } = await sb
      .from("agreements")
      .update({
        status: body.action === "verify" ? "VERIFIED" : "REJECTED",
        review_note: body.note ?? null,
        reviewed_by: caller.address,
      })
      .eq("id", id)
      .select("*")
      .single();
    dbError(error, "memperbarui status");
    return NextResponse.json({ agreement: data });
  }

  // sync with chain
  const d = getDeployment(agreement.chain_id);
  if (!d) throw new HttpError(503, "Kontrak belum di-deploy pada chain ini.");
  const tokenId = await serverClient(agreement.chain_id).readContract({
    address: d.supplyRightNFT,
    abi: supplyRightNftAbi,
    functionName: "tokenIdByPoRef",
    args: [agreement.po_hash as `0x${string}`],
  });
  if (tokenId === 0n) throw new HttpError(409, "Supply Right untuk PO ini belum dicetak onchain.");
  const { data, error } = await sb
    .from("agreements")
    .update({ status: "MINTED", token_id: Number(tokenId), mint_tx_hash: body.txHash ?? agreement.mint_tx_hash })
    .eq("id", id)
    .select("*")
    .single();
  dbError(error, "menautkan token");
  return NextResponse.json({ agreement: data });
});

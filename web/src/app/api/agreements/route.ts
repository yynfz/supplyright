import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { supplyRightNftAbi } from "@/generated/abis";
import { ROLES } from "@/lib/protocol/roles";
import { canSeeAllAgreements, requireCaller, requireRole, serverClient } from "@/lib/server/auth";
import { getDeployment } from "@/lib/server/deployments";
import { storeDocument } from "@/lib/server/documents";
import { HttpError, dbError, handle } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

const decimal = z.string().regex(/^\d+(\.\d+)?$/, "harus angka desimal positif");

const CreateBody = z.object({
  buyerAddress: z.string().optional(),
  buyerName: z.string().min(2).max(160),
  supplierName: z.string().min(2).max(160),
  supplierRef: z.string().min(2).max(80),
  materialName: z.string().min(2).max(160),
  materialCode: z.string().min(2).max(40),
  quantity: decimal,
  unit: z.string().min(1).max(8).default("MT"),
  contractValue: decimal,
  deliveryDeadline: z.string().datetime(),
  poNumber: z.string().min(2).max(60),
  incoterms: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  poDocumentId: z.string().uuid(),
  agreementDocumentId: z.string().uuid(),
  supplierAckDocumentId: z.string().uuid().optional(),
});

/** Agreements visible to the caller on its chain (buyers: own; registrar/admin/provider/verifier: all). */
export const GET = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  let q = supabaseAdmin()
    .from("agreements")
    .select("*")
    .eq("chain_id", caller.chainId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (!canSeeAllAgreements(caller)) q = q.ilike("buyer_address", caller.address);
  const { data, error } = await q;
  dbError(error, "memuat perjanjian");
  return NextResponse.json({ agreements: data ?? [] });
});

/**
 * Buyer submits a supply arrangement for registrar verification. Commercial details stay offchain; the
 * PO, agreement and a salted supplier-reference record are hashed (SHA-256) for later minting.
 */
export const POST = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  requireRole(caller, "buyer", "registrar", "admin");
  const body = CreateBody.parse(await req.json());

  let buyerAddress = caller.address;
  if (body.buyerAddress && getAddress(body.buyerAddress) !== caller.address) {
    requireRole(caller, "registrar", "admin");
    buyerAddress = getAddress(body.buyerAddress);
  }
  const d = getDeployment(caller.chainId);
  if (!d) throw new HttpError(503, "Kontrak belum di-deploy pada chain ini.");
  const isBuyer = await serverClient(caller.chainId).readContract({
    address: d.supplyRightNFT,
    abi: supplyRightNftAbi,
    functionName: "hasRole",
    args: [ROLES.BUYER_ROLE, buyerAddress],
  });
  if (!isBuyer) throw new HttpError(400, "Alamat pembeli belum di-onboard (BUYER_ROLE).");
  if (Date.parse(body.deliveryDeadline) <= Date.now()) throw new HttpError(400, "Batas waktu pengiriman harus di masa depan.");

  const sb = supabaseAdmin();
  const ids = [body.poDocumentId, body.agreementDocumentId, body.supplierAckDocumentId].filter(Boolean) as string[];
  const { data: docs, error: docErr } = await sb.from("documents").select("id, kind, sha256, uploaded_by").in("id", ids);
  dbError(docErr, "memuat dokumen");
  const byId = new Map((docs ?? []).map((x) => [x.id as string, x]));
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) throw new HttpError(400, "Dokumen pendukung tidak ditemukan.");
    if (doc.uploaded_by !== caller.address.toLowerCase()) throw new HttpError(403, "Dokumen harus diunggah oleh wallet Anda.");
  }
  const po = byId.get(body.poDocumentId)!;
  const agreement = byId.get(body.agreementDocumentId)!;
  const ack = body.supplierAckDocumentId ? byId.get(body.supplierAckDocumentId) : undefined;
  if (po.sha256 === agreement.sha256) throw new HttpError(400, "PO dan perjanjian harus dokumen berbeda.");

  const { data: dup } = await sb.from("agreements").select("id").eq("chain_id", caller.chainId).eq("po_hash", po.sha256).maybeSingle();
  if (dup) throw new HttpError(409, "Purchase order dengan hash yang sama sudah terdaftar.");

  // Salted supplier reference record: the onchain supplierRefHash cannot be brute-forced from a supplier name.
  const salt = randomBytes(16).toString("hex");
  const refDoc = await storeDocument({
    caller,
    bytes: new TextEncoder().encode(
      `SUPPLIER REFERENCE RECORD (private, salted)\nsalt        : ${salt}\nsupplier_id : ${body.supplierRef}\nlegal_name  : ${body.supplierName}\n`,
    ),
    fileName: `supplier-ref-${body.poNumber}.txt`,
    mimeType: "text/plain; charset=utf-8",
    kind: "SUPPLIER_REFERENCE",
  });

  const { data: row, error } = await sb
    .from("agreements")
    .insert({
      chain_id: caller.chainId,
      status: "SUBMITTED",
      buyer_address: buyerAddress,
      buyer_name: body.buyerName,
      supplier_name: body.supplierName,
      supplier_ref: body.supplierRef,
      supplier_salt: salt,
      supplier_ref_hash: refDoc.sha256,
      material_name: body.materialName,
      material_code: body.materialCode,
      quantity: body.quantity,
      unit: body.unit,
      contract_value: body.contractValue,
      delivery_deadline: body.deliveryDeadline,
      po_number: body.poNumber,
      incoterms: body.incoterms ?? null,
      notes: body.notes ?? null,
      po_hash: po.sha256,
      agreement_hash: agreement.sha256,
      supplier_ack_hash: ack?.sha256 ?? null,
      created_by: caller.address,
    })
    .select("*")
    .single();
  dbError(error, "menyimpan perjanjian");

  await sb.from("documents").update({ agreement_id: row!.id }).in("id", [...ids, refDoc.id]);
  return NextResponse.json({ agreement: row }, { status: 201 });
});

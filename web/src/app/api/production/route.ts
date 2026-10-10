import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller, requireRole } from "@/lib/server/auth";
import { HttpError, dbError, handle } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** The production dependency map is the manufacturer's private planning data. */
const MANUFACTURER_ROLES = ["buyer", "registrar", "admin"] as const;

const decimal = z.union([z.string().regex(/^\d+(\.\d+)?$/), z.number().nonnegative()]).transform(String);

const MaterialData = z.object({
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(40),
  criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  agreement_id: z.string().uuid().nullable().optional(),
  po_hash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable().optional(),
  reported_status: z.enum(["ON_TRACK", "REPORTED_DELAY", "ARRIVED"]).nullable().optional(),
  alternative_suppliers: z.number().int().min(0).max(100).default(0),
  alternative_lead_days: z.number().int().min(0).max(3650).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const ProductData = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().min(2).max(40),
  daily_output_units: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const DependencyData = z.object({
  material_id: z.string().uuid(),
  product_id: z.string().uuid(),
  is_blocking: z.boolean().default(true),
  est_disruption_days: z.number().int().min(0).max(3650).default(0),
  est_financial_exposure: decimal.default("0"),
  notes: z.string().max(2000).nullable().optional(),
});

const TABLE = { material: "materials", product: "products", dependency: "dependencies" } as const;
const SCHEMA = { material: MaterialData, product: ProductData, dependency: DependencyData } as const;
const Type = z.enum(["material", "product", "dependency"]);

export const GET = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  requireRole(caller, ...MANUFACTURER_ROLES);
  const sb = supabaseAdmin();
  const [m, p, d] = await Promise.all([
    sb.from("materials").select("*").eq("chain_id", caller.chainId).order("criticality").order("name"),
    sb.from("products").select("*").eq("chain_id", caller.chainId).order("name"),
    sb.from("dependencies").select("*").eq("chain_id", caller.chainId),
  ]);
  dbError(m.error ?? p.error ?? d.error, "memuat peta produksi");
  return NextResponse.json({ materials: m.data ?? [], products: p.data ?? [], dependencies: d.data ?? [] });
});

export const POST = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  requireRole(caller, ...MANUFACTURER_ROLES);
  const body = z.object({ type: Type, data: z.unknown() }).parse(await req.json());
  const data: Record<string, unknown> = SCHEMA[body.type].parse(body.data);
  const { data: row, error } = await supabaseAdmin().from(TABLE[body.type]).insert({ ...data, chain_id: caller.chainId }).select("*").single();
  if (error?.code === "23505") throw new HttpError(409, "Kode/SKU atau relasi tersebut sudah ada.");
  dbError(error, "menyimpan data produksi");
  return NextResponse.json({ row }, { status: 201 });
});

export const PATCH = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  requireRole(caller, ...MANUFACTURER_ROLES);
  const body = z.object({ type: Type, id: z.string().uuid(), data: z.unknown() }).parse(await req.json());
  const data: Record<string, unknown> = (SCHEMA[body.type] as z.AnyZodObject).partial().parse(body.data);
  const { data: row, error } = await supabaseAdmin().from(TABLE[body.type]).update(data).eq("id", body.id).eq("chain_id", caller.chainId).select("*").single();
  if (error?.code === "23505") throw new HttpError(409, "Kode/SKU atau relasi tersebut sudah ada.");
  dbError(error, "memperbarui data produksi");
  return NextResponse.json({ row });
});

export const DELETE = handle(async (req: Request) => {
  const caller = await requireCaller(req);
  requireRole(caller, ...MANUFACTURER_ROLES);
  const url = new URL(req.url);
  const type = Type.parse(url.searchParams.get("type"));
  const id = z.string().uuid().parse(url.searchParams.get("id"));
  const { error } = await supabaseAdmin().from(TABLE[type]).delete().eq("id", id).eq("chain_id", caller.chainId);
  dbError(error, "menghapus data produksi");
  return NextResponse.json({ ok: true });
});

// Seeds the PRIVATE offchain demo data into Supabase (FICTIONAL case study, testnet values only):
//   - uploads every file in ../demo/documents to the private Storage bucket and records its SHA-256
//   - agreements for the three demo purchase orders (linked to onchain supply rights by PO hash)
//   - the Production Dependency Mapper: materials, products and dependencies
//
// Usage (from web/):  npm run seed:offchain
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   optional: DEMO_CHAIN_ID (31337), LOCAL_RPC_URL / SEPOLIA_RPC_URL, DEMO_BUYER_ADDRESS, DEMO_REGISTRAR_ADDRESS,
//             DEMO_PROVIDER_ADDRESS, DEMO_VERIFIER_ADDRESS
// Idempotent: upserts only known demo PO hashes, material codes, SKUs and exact dependency edges.
// No rows are deleted. Document paths are chain-scoped under demo/<chainId>/.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, parseAbi } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = resolve(root, "../demo/documents");
const BUCKET = "supply-documents";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local).");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const chainId = Number(process.env.DEMO_CHAIN_ID || 31337);
const lower = (a) => a.toLowerCase();
const people = {
  registrar: lower(process.env.DEMO_REGISTRAR_ADDRESS || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
  buyer: process.env.DEMO_BUYER_ADDRESS || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  provider: lower(process.env.DEMO_PROVIDER_ADDRESS || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
  verifier: lower(process.env.DEMO_VERIFIER_ADDRESS || "0x90F79bf6EB2c4f870365E785982E1f101E93b906"),
};

const sha256 = (buf) => `0x${createHash("sha256").update(buf).digest("hex")}`;
function check(res, what) {
  if (res.error) {
    console.error(`✗ ${what}: ${res.error.message}`);
    process.exit(1);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const DOCS = {
  "PO-2026-0417.txt": { kind: "PURCHASE_ORDER", by: lower(people.buyer), agreement: "A" },
  "SA-2026-0417.txt": { kind: "SUPPLY_AGREEMENT", by: lower(people.buyer), agreement: "A" },
  "SUPPLIER-REF-A.txt": { kind: "SUPPLIER_REFERENCE", by: lower(people.buyer), agreement: "A" },
  "ACK-PO-2026-0417.txt": { kind: "SUPPLIER_ACK", by: people.registrar, agreement: "A" },
  "DN-0417-01.txt": { kind: "DELIVERY_NOTE", by: people.registrar, agreement: "A" },
  "PROTECTION-TERMS-PT-0417.txt": { kind: "PROTECTION_TERMS", by: lower(people.buyer), context: `request:${chainId}:1` },
  "UNDERWRITING-MEMO-0417.txt": { kind: "UNDERWRITING_MEMO", by: people.provider, context: `request:${chainId}:1` },
  "CLAIM-EVIDENCE-0417.txt": { kind: "CLAIM_EVIDENCE", by: lower(people.buyer), context: `claim:${chainId}:1` },
  "VERIFIER-REPORT-0417.txt": { kind: "VERIFIER_REPORT", by: people.verifier, context: `claim:${chainId}:1` },
  "PO-2026-0388.txt": { kind: "PURCHASE_ORDER", by: lower(people.buyer), agreement: "B" },
  "SA-2026-0388.txt": { kind: "SUPPLY_AGREEMENT", by: lower(people.buyer), agreement: "B" },
  "SUPPLIER-REF-B.txt": { kind: "SUPPLIER_REFERENCE", by: lower(people.buyer), agreement: "B" },
  "ACK-PO-2026-0388.txt": { kind: "SUPPLIER_ACK", by: people.registrar, agreement: "B" },
  "DN-0388-FINAL.txt": { kind: "DELIVERY_NOTE", by: people.registrar, agreement: "B" },
  "PO-2026-0452.txt": { kind: "PURCHASE_ORDER", by: lower(people.buyer), agreement: "C" },
  "SA-2026-0452.txt": { kind: "SUPPLY_AGREEMENT", by: lower(people.buyer), agreement: "C" },
  "SUPPLIER-REF-C.txt": { kind: "SUPPLIER_REFERENCE", by: lower(people.buyer), agreement: "C" },
  "ACK-PO-2026-0452.txt": { kind: "SUPPLIER_ACK", by: people.registrar, agreement: "C" },
};

const files = readdirSync(docsDir).filter((f) => DOCS[f]);
const hashes = Object.fromEntries(files.map((f) => [f, sha256(readFileSync(resolve(docsDir, f)))]));
const saltOf = (f) => /salt\s*:\s*([0-9a-f]+)/i.exec(readFileSync(resolve(docsDir, f), "utf8"))?.[1] ?? "demo";
const supplierIdOf = (f) => /supplier_id\s*:\s*(\S+)/i.exec(readFileSync(resolve(docsDir, f), "utf8"))?.[1] ?? "SUP-DEMO";

// ---------------------------------------------------------------------------
// Onchain linkage (optional): resolve token ids by PO hash if a deployment exists
// ---------------------------------------------------------------------------
async function tokenIdsByPo(poHashes) {
  const depFile = resolve(root, `../contracts/deployments/${chainId}.json`);
  if (!existsSync(depFile)) return {};
  const dep = JSON.parse(readFileSync(depFile, "utf8"));
  const rpc =
    chainId === 31337
      ? process.env.LOCAL_RPC_URL || process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
  const client = createPublicClient({ transport: http(rpc) });
  const abi = parseAbi(["function tokenIdByPoRef(bytes32) view returns (uint256)"]);
  const out = {};
  for (const h of poHashes) {
    try {
      const id = await client.readContract({ address: dep.supplyRightNFT, abi, functionName: "tokenIdByPoRef", args: [h] });
      if (id > 0n) out[h] = Number(id);
    } catch {
      // chain not reachable: agreements stay VERIFIED and link by PO hash at runtime
    }
  }
  return out;
}

async function main() {
  console.log(`Seeding offchain demo data for chain ${chainId} …`);

  // Identify this demo's agreements; never delete production rows or cascade their relationships.
  const demoPoHashes = ["PO-2026-0417.txt", "PO-2026-0388.txt", "PO-2026-0452.txt"].map((f) => hashes[f]);
  const existingAgreements = check(
    await sb.from("agreements").select("po_hash, token_id, delivery_deadline").eq("chain_id", chainId).in("po_hash", demoPoHashes),
    "read existing demo agreements",
  );
  const existingByPo = Object.fromEntries(existingAgreements.map((row) => [row.po_hash, row]));

  // Agreements
  const tokenIds = await tokenIdsByPo(demoPoHashes);
  const now = Date.now();
  const AGREEMENTS = {
    A: {
      po: "PO-2026-0417.txt", sa: "SA-2026-0417.txt", ref: "SUPPLIER-REF-A.txt", ack: "ACK-PO-2026-0417.txt",
      supplier_name: "PT Contoh Logam Nusantara (fiktif)", material_name: "Nikel Sulfat (battery grade)",
      material_code: "MAT-A-NISO4", quantity: "50", contract_value: "100", po_number: "PO-2026-0417",
      incoterms: "DAP Cikarang", deadline: now + 3 * 60_000,
      notes: "Material kritis untuk Modul Baterai EV-48V. Uang muka 30% telah dibayar.",
    },
    B: {
      po: "PO-2026-0388.txt", sa: "SA-2026-0388.txt", ref: "SUPPLIER-REF-B.txt", ack: "ACK-PO-2026-0388.txt",
      supplier_name: "PT Contoh Kimia Andalas (fiktif)", material_name: "Litium Karbonat (battery grade)",
      material_code: "MAT-B-LI2CO3", quantity: "12", contract_value: "36", po_number: "PO-2026-0388",
      incoterms: "CIF Tanjung Priok", deadline: now + 10 * 86_400_000, notes: "Sudah diterima lengkap.",
    },
    C: {
      po: "PO-2026-0452.txt", sa: "SA-2026-0452.txt", ref: "SUPPLIER-REF-C.txt", ack: "ACK-PO-2026-0452.txt",
      supplier_name: "PT Contoh Aluminium Sulawesi (fiktif)", material_name: "Aluminium Ingot A7",
      material_code: "MAT-C-ALA7", quantity: "80", contract_value: "48", po_number: "PO-2026-0452",
      incoterms: "FOB Makassar", deadline: now + 45 * 86_400_000, notes: "Belum diproteksi.",
    },
  };
  const agreementIds = {};
  for (const [k, a] of Object.entries(AGREEMENTS)) {
    const poHash = hashes[a.po];
    const previous = existingByPo[poHash];
    const tokenId = tokenIds[poHash] ?? previous?.token_id ?? null;
    const row = check(
      await sb
        .from("agreements")
        .upsert({
          chain_id: chainId,
          token_id: tokenId,
          status: tokenId ? "MINTED" : "VERIFIED",
          buyer_address: people.buyer,
          buyer_name: "PT Contoh Manufaktur Baterai (fiktif)",
          supplier_name: a.supplier_name,
          supplier_ref: supplierIdOf(resolve(docsDir, a.ref)),
          supplier_salt: saltOf(resolve(docsDir, a.ref)),
          supplier_ref_hash: hashes[a.ref],
          material_name: a.material_name,
          material_code: a.material_code,
          quantity: a.quantity,
          unit: "MT",
          contract_value: a.contract_value,
          delivery_deadline: previous?.delivery_deadline ?? new Date(a.deadline).toISOString(),
          po_number: a.po_number,
          incoterms: a.incoterms,
          notes: a.notes,
          po_hash: poHash,
          agreement_hash: hashes[a.sa],
          supplier_ack_hash: hashes[a.ack],
          review_note: "Dokumen demo fiktif diverifikasi registrar.",
          reviewed_by: people.registrar,
          created_by: people.buyer,
        }, { onConflict: "chain_id,po_hash" })
        .select("id")
        .single(),
      `agreement ${k}`,
    );
    agreementIds[k] = row.id;
    console.log(`  ✓ agreement ${a.po_number} ${tokenId ? `(Supply Right #${tokenId})` : "(belum dicetak onchain)"}`);
  }

  // Documents → private bucket
  for (const f of files) {
    const meta = DOCS[f];
    const bytes = readFileSync(resolve(docsDir, f));
    const path = `demo/${chainId}/${f}`;
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "text/plain; charset=utf-8", upsert: true });
    if (up.error) {
      console.error(`✗ upload ${f}: ${up.error.message}`);
      process.exit(1);
    }
    check(
      await sb.from("documents").upsert({
        agreement_id: meta.agreement ? agreementIds[meta.agreement] : null,
        context_key: meta.context ?? null,
        kind: meta.kind,
        file_name: f,
        mime_type: "text/plain",
        size_bytes: bytes.byteLength,
        sha256: hashes[f],
        storage_path: path,
        uploaded_by: meta.by,
      }, { onConflict: "storage_path" }),
      `document ${f}`,
    );
  }
  console.log(`  ✓ ${files.length} dokumen demo diunggah ke bucket privat "${BUCKET}"`);

  // Production Dependency Mapper
  const materials = check(
    await sb
      .from("materials")
      .upsert([
        { name: "Nikel Sulfat (battery grade)", code: "MAT-A-NISO4", criticality: "CRITICAL", agreement_id: agreementIds.A, po_hash: hashes["PO-2026-0417.txt"], alternative_suppliers: 0, notes: "Pemasok tunggal; kualifikasi pemasok baru ±60 hari." },
        { name: "Litium Karbonat (battery grade)", code: "MAT-B-LI2CO3", criticality: "HIGH", agreement_id: agreementIds.B, po_hash: hashes["PO-2026-0388.txt"], alternative_suppliers: 1, alternative_lead_days: 30 },
        { name: "Aluminium Ingot A7", code: "MAT-C-ALA7", criticality: "MEDIUM", agreement_id: agreementIds.C, po_hash: hashes["PO-2026-0452.txt"], alternative_suppliers: 2, alternative_lead_days: 10 },
        { name: "Separator Film PE 16µm", code: "MAT-D-SEPPE", criticality: "HIGH", reported_status: "ARRIVED", alternative_suppliers: 1, alternative_lead_days: 21, notes: "Stok gudang 45 hari (tanpa PO onchain)." },
      ], { onConflict: "code" })
      .select("id, code"),
    "materials",
  );
  const m = Object.fromEntries(materials.map((x) => [x.code, x.id]));
  const products = check(
    await sb
      .from("products")
      .upsert([
        { name: "Modul Baterai EV-48V", sku: "PRD-X-EV48", daily_output_units: 120, notes: "Produk X — butuh nikel sulfat, litium karbonat, separator." },
        { name: "Rangka Inverter 5 kW", sku: "PRD-Y-INV5", daily_output_units: 80, notes: "Produk Y — butuh aluminium ingot." },
      ], { onConflict: "sku" })
      .select("id, sku"),
    "products",
  );
  const p = Object.fromEntries(products.map((x) => [x.sku, x.id]));
  check(
    await sb.from("dependencies").upsert([
      { material_id: m["MAT-A-NISO4"], product_id: p["PRD-X-EV48"], is_blocking: true, est_disruption_days: 21, est_financial_exposure: "60", notes: "Tanpa nikel sulfat, katoda tidak dapat diproduksi." },
      { material_id: m["MAT-B-LI2CO3"], product_id: p["PRD-X-EV48"], is_blocking: true, est_disruption_days: 14, est_financial_exposure: "25" },
      { material_id: m["MAT-D-SEPPE"], product_id: p["PRD-X-EV48"], is_blocking: true, est_disruption_days: 7, est_financial_exposure: "10" },
      { material_id: m["MAT-C-ALA7"], product_id: p["PRD-Y-INV5"], is_blocking: true, est_disruption_days: 10, est_financial_exposure: "18" },
    ], { onConflict: "material_id,product_id" }),
    "dependencies",
  );
  console.log("  ✓ peta dependensi produksi: 4 material, 2 produk, 4 dependensi");
  console.log("Selesai. Semua data adalah studi kasus FIKTIF untuk testnet.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

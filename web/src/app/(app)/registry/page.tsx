"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, FileCheck2, Loader2, Plus, RefreshCw } from "lucide-react";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, stringToHex, type Hex } from "viem";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, PageHeader, SectionTitle } from "@/components/page";
import { AddressChip, TxLink } from "@/components/onchain";
import { DocumentHash, DocumentUpload, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { TxStatus } from "@/components/tx-status";
import { supplyRightNftAbi } from "@/generated/abis";
import { useAgreements, useAgreement, useAgreementMutation, useCreateAgreement } from "@/hooks/use-offchain";
import { useActiveChain, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { useProtocolTx } from "@/hooks/use-protocol-tx";
import { useChainRead } from "@/hooks/claims-chain-read";
import type { Agreement, AgreementStatus, StoredDocument } from "@/lib/offchain-types";
import { formatDateTime, formatQty, formatToken } from "@/lib/format";
import { supplyStatusLabel, type Tone } from "@/lib/protocol/labels";
import { errorMessage, exactPositiveDecimal, validUnit } from "./registry-utils";

const inputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50";
const agreementLabel: Record<AgreementStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "Menunggu review", tone: "warning" },
  VERIFIED: { label: "Terverifikasi · belum ditautkan", tone: "info" },
  MINTED: { label: "Dicetak onchain", tone: "success" },
  REJECTED: { label: "Ditolak registrar", tone: "danger" },
};

function CreateAgreementForm({ onCreated }: { onCreated: (agreement: Agreement) => void }) {
  const { address } = useAccount();
  const roles = useRoles(address);
  const create = useCreateAgreement();
  const [po, setPo] = useState<StoredDocument | null>(null);
  const [agreementDoc, setAgreementDoc] = useState<StoredDocument | null>(null);
  const [ack, setAck] = useState<StoredDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ buyerAddress: address ?? "", buyerName: "", supplierName: "", supplierRef: "", materialName: "", materialCode: "", quantity: "", unit: "MT", contractValue: "", deliveryDeadline: "", poNumber: "", incoterms: "", notes: "" });
  const canChooseBuyer = !!roles.data?.registrar || !!roles.data?.admin;
  const update = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const fields: { key: keyof typeof form; label: string; max?: number; type?: string; placeholder?: string }[] = [
    { key: "buyerName", label: "Nama legal pembeli", max: 160 },
    { key: "supplierName", label: "Nama legal pemasok", max: 160 },
    { key: "supplierRef", label: "ID / referensi pemasok (privat)", max: 80 },
    { key: "poNumber", label: "Nomor Purchase Order", max: 60 },
    { key: "materialName", label: "Nama material", max: 160 },
    { key: "materialCode", label: "Kode material", max: 40 },
    { key: "quantity", label: "Kuantitas pesanan (maks. 3 desimal)", placeholder: "50" },
    { key: "unit", label: "Satuan (maks. 8 karakter)", max: 8, placeholder: "MT" },
    { key: "contractValue", label: "Nilai kontrak (ETH, maks. 18 desimal)", placeholder: "0.05" },
    { key: "deliveryDeadline", label: "Batas pengiriman (waktu lokal browser)", type: "datetime-local" },
  ];
  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      try {
        if (!po || !agreementDoc) throw new Error("Unggah Purchase Order dan perjanjian pasokan terlebih dahulu.");
        if (po.sha256 === agreementDoc.sha256) throw new Error("PO dan perjanjian harus berupa dokumen yang berbeda.");
        if (!isAddress(form.buyerAddress)) throw new Error("Alamat wallet pembeli tidak valid.");
        const quantity = exactPositiveDecimal(form.quantity, 3, "Kuantitas").text;
        const contractValue = exactPositiveDecimal(form.contractValue, 18, "Nilai kontrak").text;
        const deadline = new Date(form.deliveryDeadline);
        if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) throw new Error("Batas pengiriman harus di masa depan.");
        const created = await create.mutateAsync({ ...form, buyerAddress: form.buyerAddress, buyerName: form.buyerName.trim(), supplierName: form.supplierName.trim(), supplierRef: form.supplierRef.trim(), materialName: form.materialName.trim(), materialCode: form.materialCode.trim(), poNumber: form.poNumber.trim(), quantity, unit: validUnit(form.unit), contractValue, deliveryDeadline: deadline.toISOString(), poDocumentId: po.id, agreementDocumentId: agreementDoc.id, supplierAckDocumentId: ack?.id });
        toast.success("Perjanjian diajukan untuk review registrar");
        onCreated(created);
      } catch (cause) { setError(errorMessage(cause)); }
    }}>
      <p className="text-xs text-muted-foreground">Pembeli harus memiliki BUYER_ROLE. Dokumen disimpan di bucket privat Supabase. Registrar memeriksa perjanjian sebelum mencetak NFT.</p>
      <label className="block space-y-1 text-xs font-medium">
        <span>Alamat wallet pembeli</span>
        <input className={inputClass} value={form.buyerAddress} onChange={(e) => update("buyerAddress", e.target.value)} disabled={!canChooseBuyer || create.isPending} required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => <label key={field.key} className="block space-y-1 text-xs font-medium">
          <span>{field.label}</span>
          <input className={inputClass} type={field.type ?? "text"} value={form[field.key]} onChange={(e) => update(field.key, e.target.value)} maxLength={field.max} minLength={field.max && field.key !== "unit" ? 2 : undefined} placeholder={field.placeholder} required disabled={create.isPending} inputMode={field.key === "quantity" || field.key === "contractValue" ? "decimal" : undefined} />
        </label>)}
      </div>
      <label className="block space-y-1 text-xs font-medium"><span>Incoterms (opsional)</span><input className={inputClass} value={form.incoterms} maxLength={40} onChange={(e) => update("incoterms", e.target.value)} disabled={create.isPending} /></label>
      <label className="block space-y-1 text-xs font-medium"><span>Catatan komersial (opsional)</span><textarea className={`${inputClass} h-20 py-2`} value={form.notes} maxLength={2000} onChange={(e) => update("notes", e.target.value)} disabled={create.isPending} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <DocumentUpload kind="PURCHASE_ORDER" value={po} onUploaded={setPo} label="Purchase Order (wajib)" disabled={create.isPending} />
        <DocumentUpload kind="SUPPLY_AGREEMENT" value={agreementDoc} onUploaded={setAgreementDoc} label="Perjanjian bertanda tangan (wajib)" disabled={create.isPending} />
      </div>
      <DocumentUpload kind="SUPPLIER_ACK" value={ack} onUploaded={setAck} label="Konfirmasi pemasok (opsional; diperlukan saat aktivasi)" disabled={create.isPending} />
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <Button type="submit" disabled={create.isPending || !po || !agreementDoc}>{create.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}Ajukan perjanjian</Button>
    </form>
  );
}

function AgreementPanel({ agreement, unlocked }: { agreement: Agreement; unlocked: boolean }) {
  const { address } = useAccount();
  const active = useActiveChain();
  const roles = useRoles(address);
  const client = usePublicClient({ chainId: active.chainId });
  const detail = useAgreement(agreement.id, unlocked);
  const mutation = useAgreementMutation();
  const tx = useProtocolTx();
  const [reviewNote, setReviewNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const pendingKey = `supplyright.mint:${agreement.chain_id}:${agreement.id}`;
  const [minedHash, setMinedHash] = useState<Hex | null>(() => {
    try { const saved = sessionStorage.getItem(pendingKey); return saved && /^0x[0-9a-fA-F]{64}$/.test(saved) ? saved as Hex : null; } catch { return null; }
  });
  const minted = useChainRead(["agreement-mint", agreement.id, agreement.po_hash], (rpc, deployment) => rpc.readContract({ address: deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "tokenIdByPoRef", args: [agreement.po_hash as Hex] }));
  const row = detail.data?.agreement ?? agreement;
  const docFor = (hash: string) => detail.data?.documents.find((doc) => doc.sha256.toLowerCase() === hash.toLowerCase());
  const canReview = !!roles.data?.registrar || !!roles.data?.admin;
  const canMint = !!roles.data?.registrar;
  const alreadyMinted = !!minedHash || (minted.data ?? 0n) > 0n;
  const busy = working || mutation.isPending || tx.busy;
  async function review(action: "verify" | "reject") {
    setError(null);
    try {
      if (action === "reject" && reviewNote.trim().length < 5) throw new Error("Alasan penolakan minimal 5 karakter.");
      await mutation.mutateAsync({ id: row.id, action, note: reviewNote.trim() || undefined });
      toast.success(action === "verify" ? "Review registrar tersimpan" : "Penolakan tersimpan");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function mintOrSync(syncOnly = false) {
    setWorking(true); setError(null);
    try {
      if (!client || !active.deployment) throw new Error("Deployment dan RPC belum siap.");
      if (row.chain_id !== active.chainId) throw new Error("Pilih jaringan yang sama dengan perjanjian.");
      let hash = minedHash ?? row.mint_tx_hash as Hex | null;
      const tokenId = await client.readContract({ address: active.deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "tokenIdByPoRef", args: [row.po_hash as Hex] });
      if (tokenId === 0n) {
        if (syncOnly || hash) throw new Error("PO belum ditemukan onchain pada jaringan ini. Periksa transaksi sebelum mencoba lagi.");
        if (row.status !== "VERIFIED" || !canMint) throw new Error("Mint membutuhkan perjanjian terverifikasi dan REGISTRAR_ROLE.");
        const deadline = Math.floor(Date.parse(row.delivery_deadline) / 1000);
        if (!Number.isSafeInteger(deadline) || deadline <= Number((await client.getBlock()).timestamp)) throw new Error("Batas pengiriman sudah lewat; perjanjian ini tidak dapat dicetak.");
        const receipt = await tx.send({ label: "Cetak Supply Right", address: active.deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "mintSupplyRight", args: [{ buyer: row.buyer_address, poRefHash: row.po_hash, agreementHash: row.agreement_hash, supplierRefHash: row.supplier_ref_hash, contractValue: exactPositiveDecimal(row.contract_value, 18, "Nilai kontrak").value, orderedQuantity: exactPositiveDecimal(row.quantity, 3, "Kuantitas").value, deliveryDeadline: BigInt(deadline), unit: stringToHex(validUnit(row.unit), { size: 8 }) }] });
        if (!receipt) return;
        hash = receipt.transactionHash;
        setMinedHash(hash);
        try { sessionStorage.setItem(pendingKey, hash); } catch {}
      }
      const synced = await mutation.mutateAsync({ id: row.id, action: "sync", txHash: hash ?? undefined });
      try { sessionStorage.removeItem(pendingKey); } catch {}
      setMinedHash(null);
      toast.success(`Perjanjian ditautkan ke Supply Right #${synced.token_id}`);
      await detail.refetch();
      await minted.refetch();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setWorking(false); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span>{row.po_number} · {row.material_name}</span><StatusBadge {...agreementLabel[row.status]} /></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {detail.isLoading && <p className="text-xs text-muted-foreground">Memuat dokumen privat…</p>}
        {detail.error && <p className="text-sm text-rose-700">{errorMessage(detail.error)} <button className="underline" onClick={() => detail.refetch()}>Coba lagi</button></p>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Pembeli">{row.buyer_name}<div className="mt-1"><AddressChip address={row.buyer_address} /></div></Field>
          <Field label="Pemasok">{row.supplier_name} · {row.supplier_ref}</Field>
          <Field label="Pesanan">{row.quantity} {row.unit} · {row.material_code}</Field>
          <Field label="Nilai kontrak">{row.contract_value} ETH</Field>
          <Field label="Batas pengiriman">{formatDateTime(Date.parse(row.delivery_deadline) / 1000)}</Field>
          <Field label="Incoterms">{row.incoterms || "—"}</Field>
        </dl>
        {row.notes && <p className="whitespace-pre-wrap text-sm">{row.notes}</p>}
        <dl className="space-y-3">
          <Field label="Purchase Order"><DocumentHash hash={row.po_hash} doc={docFor(row.po_hash)} /></Field>
          <Field label="Perjanjian pasokan"><DocumentHash hash={row.agreement_hash} doc={docFor(row.agreement_hash)} /></Field>
          <Field label="Referensi pemasok salted"><DocumentHash hash={row.supplier_ref_hash} doc={docFor(row.supplier_ref_hash)} /></Field>
          <Field label="Konfirmasi pemasok"><DocumentHash hash={row.supplier_ack_hash} doc={row.supplier_ack_hash ? docFor(row.supplier_ack_hash) : undefined} /></Field>
        </dl>
        {row.review_note && <p className="rounded-md bg-muted p-3 text-xs"><strong>Catatan registrar:</strong> {row.review_note}</p>}
        {row.status === "MINTED" && row.token_id && <div className="flex flex-wrap items-center gap-3"><Button asChild size="sm"><Link href={`/supply/${row.token_id}`}>Supply Right #{row.token_id}<ArrowRight className="size-4" /></Link></Button>{row.mint_tx_hash && <TxLink hash={row.mint_tx_hash} />}</div>}
        {canReview && (row.status === "SUBMITTED" || row.status === "VERIFIED") && !alreadyMinted && <div className="space-y-3 border-t pt-4">
          <label className="block space-y-1 text-xs font-medium"><span>Catatan review / alasan penolakan</span><textarea className={`${inputClass} h-20 py-2`} maxLength={2000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={busy} /></label>
          {row.status === "SUBMITTED" && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={busy} /><span>Saya sudah memeriksa PO, perjanjian bertanda tangan, pihak terkait, dan ketentuan pasokan.</span></label>}
          <div className="flex flex-wrap gap-2">{row.status === "SUBMITTED" && <Button size="sm" disabled={busy || !reviewed || detail.isLoading || !!detail.error || !detail.data?.documents.length} onClick={() => review("verify")}>Verifikasi perjanjian</Button>}<Button variant="outline" size="sm" disabled={busy || reviewNote.trim().length < 5} onClick={() => review("reject")}>Tolak</Button></div>
        </div>}
        {(alreadyMinted && row.status !== "MINTED") ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs"><p>Supply Right sudah dicetak. Sinkronkan ke Supabase untuk menautkan data komersial; transaksi mint tidak perlu diulang.</p>{minedHash && <TxLink hash={minedHash} />}<Button size="sm" variant="outline" disabled={busy} onClick={() => mintOrSync(true)}><RefreshCw className="size-3.5" />Sinkronkan hasil mint</Button></div> : row.status === "VERIFIED" && <div className="space-y-2 border-t pt-4"><p className="text-xs text-muted-foreground">REGISTRAR_ROLE mencetak catatan NFT dari hash dokumen dan ketentuan ekonomi terverifikasi.</p><div className="flex flex-wrap gap-2"><Button disabled={busy || !canMint || !active.deployment || active.wrongNetwork || minted.isLoading || !!minted.error} onClick={() => mintOrSync()}>Cetak Supply Right NFT</Button><Button size="sm" variant="outline" disabled={busy || !active.deployment} onClick={() => mintOrSync(true)}>Cari & sinkronkan mint</Button></div>{!canMint && <p className="text-xs text-muted-foreground">Wallet ini tidak memiliki REGISTRAR_ROLE untuk mint.</p>}</div>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <TxStatus state={tx.state} />
      </CardContent>
    </Card>
  );
}

export default function RegistryPage() {
  const { address } = useAccount();
  const active = useActiveChain();
  const snapshot = useProtocolSnapshot();
  const roles = useRoles(address);
  const [unlocked, unlockButton] = usePrivateAccess();
  const agreements = useAgreements(unlocked);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");
  const canCreate = !!roles.data && (roles.data.buyer || roles.data.registrar || roles.data.admin);
  const selected = agreements.data?.find((agreement) => agreement.id === selectedId);
  const filtered = (agreements.data ?? []).filter((agreement) => status === "ALL" || agreement.status === status);
  return (
    <div className="space-y-6">
      <PageHeader title="Supply Registry" eyebrow="Perjanjian → Supply Right" description="Daftarkan dokumen pasokan, minta review registrar, lalu catat hak pasokan terverifikasi onchain." actions={unlocked && canCreate && <Button onClick={() => setCreating(!creating)}><Plus className="size-4" />{creating ? "Tutup formulir" : "Daftarkan perjanjian"}</Button>} />
      <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-4 text-xs text-teal-900">NFT merepresentasikan hak pasokan berdasarkan perjanjian yang sudah ada. Kewajiban hukum dan hak penagihan mengikuti perjanjian bertanda tangan. Nama pemasok dan dokumen tetap privat; wallet pembeli, nilai kontrak, kuantitas, tenggat, status, dan hash dicatat publik onchain.</div>
      <Card><CardHeader><CardTitle className="text-base">Perjanjian komersial privat</CardTitle></CardHeader><CardContent className="space-y-4">
        {!unlocked ? <EmptyState title={address ? "Buka data privat untuk mengelola perjanjian" : "Hubungkan wallet untuk mengelola perjanjian"} description="Akses menggunakan tanda tangan pesan login tanpa gas. Server membatasi data sesuai wallet dan peran Anda." action={unlockButton} /> : <>
          {roles.error && <p className="text-sm text-rose-700">Gagal membaca peran wallet: {errorMessage(roles.error)}</p>}
          {agreements.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Memuat perjanjian…</p> : agreements.error ? <EmptyState title="Data privat belum dapat dimuat" description={errorMessage(agreements.error)} action={<Button variant="outline" onClick={() => agreements.refetch()}>Coba lagi</Button>} /> : <>
            <div className="flex flex-wrap items-center justify-between gap-3"><select aria-label="Filter status perjanjian" className={`${inputClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">Semua status</option>{Object.entries(agreementLabel).map(([value, label]) => <option key={value} value={value}>{label.label}</option>)}</select><span className="text-xs text-muted-foreground">{agreements.data?.length ?? 0} perjanjian · maksimal 200 terbaru</span></div>
            {!filtered.length ? <EmptyState title="Belum ada perjanjian pada filter ini" description="Ajukan PO dan perjanjian pasokan untuk memulai review registrar." /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="py-3 pr-4">PO / Material</th><th className="py-3 pr-4">Pembeli / Pemasok</th><th className="py-3 pr-4">Status</th><th className="py-3 text-right">Aksi</th></tr></thead><tbody>{filtered.map((agreement) => <tr key={agreement.id} className="border-b last:border-0"><td className="py-3 pr-4"><span className="font-medium text-navy">{agreement.po_number}</span><p className="text-xs text-muted-foreground">{agreement.material_name} · {agreement.quantity} {agreement.unit}</p></td><td className="py-3 pr-4"><span>{agreement.buyer_name}</span><p className="text-xs text-muted-foreground">{agreement.supplier_name}</p></td><td className="py-3 pr-4"><StatusBadge {...agreementLabel[agreement.status]} /></td><td className="py-3 text-right"><Button size="sm" variant={selectedId === agreement.id ? "secondary" : "outline"} onClick={() => setSelectedId(selectedId === agreement.id ? null : agreement.id)}>Review & detail</Button></td></tr>)}</tbody></table></div>}
          </>}
        </>}
      </CardContent></Card>
      {creating && unlocked && canCreate && <Card><CardHeader><CardTitle className="text-base">Ajukan perjanjian pasokan</CardTitle></CardHeader><CardContent><CreateAgreementForm key={`${active.chainId}:${address}`} onCreated={(agreement) => { setSelectedId(agreement.id); setCreating(false); setStatus("ALL"); }} /></CardContent></Card>}
      {selected && unlocked && <AgreementPanel key={`${active.chainId}:${address}:${selected.id}`} agreement={selected} unlocked={unlocked} />}
      <Card><CardContent className="pt-6">
        <SectionTitle description="Status, jumlah, dan hash dibaca langsung dari kontrak pada jaringan aktif.">Supply Rights publik</SectionTitle>
        {active.configLoading ? <p className="text-sm text-muted-foreground">Memuat konfigurasi deployment…</p> : !active.deployment ? <EmptyState title="Kontrak belum tersedia pada jaringan ini" description="Pilih jaringan dengan deployment SupplyRight untuk membaca registry." /> : snapshot.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Membaca registry onchain…</p> : snapshot.error ? <EmptyState title="RPC belum dapat membaca registry" description={errorMessage(snapshot.error)} action={<Button variant="outline" onClick={() => snapshot.refetch()}>Coba lagi</Button>} /> : !snapshot.data?.supplyRights.length ? <EmptyState title="Belum ada Supply Right" description="Registrar dapat mencetak NFT setelah perjanjian selesai diverifikasi." /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="py-3 pr-4">Supply Right</th><th className="py-3 pr-4">Pembeli</th><th className="py-3 pr-4">Pesanan / Nilai</th><th className="py-3 pr-4">Tenggat / Status</th><th className="py-3 text-right">Detail</th></tr></thead><tbody>{snapshot.data.supplyRights.map((right) => <tr key={right.id} className="border-b last:border-0"><td className="py-3 pr-4 font-semibold text-navy">#{right.id}<p className="mt-1 text-xs font-normal text-muted-foreground">{right.protectionId ? `Proteksi #${right.protectionId}` : "Tanpa proteksi"}</p></td><td className="py-3 pr-4"><AddressChip address={right.buyer} /></td><td className="py-3 pr-4">{formatQty(right.orderedQuantity, right.unit)}<p className="text-xs text-muted-foreground">{formatToken(right.contractValue)}</p></td><td className="py-3 pr-4"><p className="mb-1 text-xs text-muted-foreground">{formatDateTime(right.deliveryDeadline)}</p><StatusBadge {...supplyStatusLabel[right.status]} /></td><td className="py-3 text-right"><Button asChild variant="outline" size="sm"><Link href={`/supply/${right.id}`}><ArrowRight className="size-4" /><span className="sr-only">Detail Supply Right #{right.id}</span></Link></Button></td></tr>)}</tbody></table></div>}
      </CardContent></Card>
    </div>
  );
}

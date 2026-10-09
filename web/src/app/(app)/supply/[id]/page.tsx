"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, PackageCheck, ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { hexToString, type Hex } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, KpiCard, Meter, PageHeader, SectionTitle } from "@/components/page";
import { AddressChip, NftLink } from "@/components/onchain";
import { AuditTimeline } from "@/components/audit-timeline";
import { DocumentHash, DocumentUpload, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { TxStatus } from "@/components/tx-status";
import { claimManagerAbi, supplyRightNftAbi, vaultAbi } from "@/generated/abis";
import { useAgreement, useAgreements, useDocumentIndex, useDocuments } from "@/hooks/use-offchain";
import { useChainRead } from "@/hooks/claims-chain-read";
import { useActiveChain, useRoles } from "@/hooks/use-protocol";
import { useProtocolTx } from "@/hooks/use-protocol-tx";
import { contextKey, type Agreement, type StoredDocument } from "@/lib/offchain-types";
import { formatBps, formatDateTime, formatQty, formatToken } from "@/lib/format";
import { protectionStatusLabel, supplyStatusLabel } from "@/lib/protocol/labels";
import { SupplyStatus, type SupplyRight } from "@/lib/protocol/types";
import { errorMessage, exactPositiveDecimal } from "../../registry/registry-utils";

const inputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50";

function LifecycleActions({ right, agreement, unlocked, existingAck }: { right: SupplyRight; agreement?: Agreement; unlocked: boolean; existingAck?: StoredDocument }) {
  const active = useActiveChain();
  const { address } = useAccount();
  const roles = useRoles(address);
  const tx = useProtocolTx();
  const [ack, setAck] = useState<StoredDocument | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<StoredDocument | null>(null);
  const [closingMemo, setClosingMemo] = useState<StoredDocument | null>(null);
  const [quantity, setQuantity] = useState("");
  const [confirmedFull, setConfirmedFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const releaseGuard = useChainRead(["supply-close-guard", right.protectionId], (client, deployment) => client.readContract({ address: deployment.claimManager, abi: claimManagerAbi, functionName: "isReleaseBlocked", args: [BigInt(right.protectionId)] }), { enabled: right.protectionId > 0 });
  const canClose = [SupplyStatus.Registered, SupplyStatus.Fulfilled, SupplyStatus.Defaulted].includes(right.status);
  const deliveryAllowed = [SupplyStatus.Active, SupplyStatus.UnderAssessment, SupplyStatus.Defaulted].includes(right.status);
  const closingBlocked = right.protectionId > 0 && (releaseGuard.data !== false || !!releaseGuard.error);
  const currentAck = ack ?? existingAck;
  const ackHash = currentAck?.sha256 ?? agreement?.supplier_ack_hash;
  const key = contextKey("supply", active.chainId, right.id);
  async function act(functionName: string, label: string, hash: string | undefined | null, delivered?: bigint) {
    setError(null);
    try {
      if (!active.deployment) throw new Error("Kontrak belum tersedia pada jaringan ini.");
      if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash) || /^0x0+$/.test(hash)) throw new Error("Unggah dokumen bukti terlebih dahulu.");
      if (functionName === "close" && closingBlocked) throw new Error("Penutupan masih diblokir oleh klaim aktif, masa banding, atau RPC guard yang belum siap.");
      await tx.send({ label, address: active.deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName, args: functionName === "recordDelivery" ? [BigInt(right.id), delivered!, hash as Hex] : [BigInt(right.id), hash as Hex] });
    } catch (cause) { setError(errorMessage(cause)); }
  }
  if (!address) return <EmptyState title="Hubungkan wallet untuk melihat aksi registrar" description="Aktivasi, pencatatan pengiriman, dan penutupan membutuhkan REGISTRAR_ROLE." />;
  if (roles.isLoading) return <p className="text-sm text-muted-foreground">Memeriksa peran wallet…</p>;
  if (roles.error) return <p className="text-sm text-rose-700">Gagal memeriksa peran: {errorMessage(roles.error)}</p>;
  if (!roles.data?.registrar) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aksi lifecycle hanya tersedia bagi registrar. Pembeli dapat mengajukan proteksi dan klaim melalui halaman terkait.</p>;
  if (!unlocked) return <p className="text-sm text-muted-foreground">Buka data privat untuk melampirkan konfirmasi pemasok dan dokumen bukti.</p>;
  return (
    <div className="space-y-4">
      {right.status === SupplyStatus.Registered && <div className="space-y-3 rounded-lg border p-4">
        <SectionTitle description="Registrar merekam hash konfirmasi pemasok berdasarkan perjanjian yang sudah ditandatangani.">Aktivasi pasokan</SectionTitle>
        <DocumentUpload kind="SUPPLIER_ACK" agreementId={agreement?.id} contextKey={key} value={currentAck} onUploaded={setAck} disabled={tx.busy} />
        {!currentAck && agreement?.supplier_ack_hash && <DocumentHash hash={agreement.supplier_ack_hash} fallbackLabel="Konfirmasi terlampir pada perjanjian" />}
        <Button size="sm" disabled={tx.busy || !ackHash || active.wrongNetwork} onClick={() => act("activate", "Aktifkan Supply Right", ackHash)}>Aktifkan hak pasokan</Button>
      </div>}
      {deliveryAllowed && <div className="space-y-3 rounded-lg border p-4">
        <SectionTitle description="Catat total kumulatif yang benar-benar diterima. Jumlah tidak dapat berkurang atau melampaui pesanan.">Pengiriman terverifikasi</SectionTitle>
        <DocumentUpload kind="DELIVERY_NOTE" agreementId={agreement?.id} contextKey={key} value={deliveryNote} onUploaded={setDeliveryNote} disabled={tx.busy} />
        <label className="block max-w-sm space-y-1 text-xs font-medium"><span>Total diterima ({right.unit}, maks. 3 desimal)</span><input className={inputClass} value={quantity} inputMode="decimal" placeholder="Kuantitas kumulatif" onChange={(event) => setQuantity(event.target.value)} disabled={tx.busy} /></label>
        <p className="text-xs text-muted-foreground">Saat ini {formatQty(right.deliveredQuantity, right.unit)} dari {formatQty(right.orderedQuantity, right.unit)}.</p>
        <Button size="sm" variant="outline" disabled={tx.busy || !deliveryNote || !quantity || active.wrongNetwork} onClick={() => {
          try {
            const cumulative = exactPositiveDecimal(quantity, 3, "Kuantitas diterima").value;
            if (cumulative < right.deliveredQuantity || cumulative > right.orderedQuantity) throw new Error("Kuantitas harus setidaknya sebesar catatan sebelumnya dan tidak melebihi pesanan.");
            void act("recordDelivery", "Catat pengiriman", deliveryNote?.sha256, cumulative);
          } catch (cause) { setError(errorMessage(cause)); }
        }}>Catat pengiriman kumulatif</Button>
        {right.status === SupplyStatus.Active && <div className="space-y-2 border-t pt-3"><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmedFull} onChange={(event) => setConfirmedFull(event.target.checked)} disabled={tx.busy} /><span>Saya memverifikasi seluruh {formatQty(right.orderedQuantity, right.unit)} telah diterima dan delivery note mendukungnya.</span></label><Button size="sm" disabled={tx.busy || !deliveryNote || !confirmedFull || active.wrongNetwork} onClick={() => act("markFulfilled", "Konfirmasi pengiriman lengkap", deliveryNote?.sha256)}><PackageCheck className="size-4" />Tandai terpenuhi</Button></div>}
      </div>}
      {canClose && <div className="space-y-3 rounded-lg border p-4">
        <SectionTitle description="Penutupan bersifat final. Klaim terbuka dan masa banding harus selesai terlebih dahulu.">Tutup Supply Right</SectionTitle>
        <DocumentUpload kind="CLOSING_MEMO" agreementId={agreement?.id} contextKey={key} value={closingMemo} onUploaded={setClosingMemo} disabled={tx.busy} />
        {closingBlocked && <p className="text-xs text-amber-700">{releaseGuard.error ? `Pemeriksaan klaim gagal: ${errorMessage(releaseGuard.error)}` : releaseGuard.isLoading ? "Memeriksa status klaim dan masa banding…" : "Klaim atau masa banding masih memblokir penutupan."}</p>}
        <Button size="sm" variant="outline" disabled={tx.busy || !closingMemo || closingBlocked || active.wrongNetwork} onClick={() => act("close", "Tutup Supply Right", closingMemo?.sha256)}>Tutup hak pasokan</Button>
      </div>}
      {right.status === SupplyStatus.Closed && <p className="text-sm text-muted-foreground">Supply Right sudah ditutup; catatan dan audit tetap dapat diverifikasi.</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <TxStatus state={tx.state} />
    </div>
  );
}

export default function SupplyDetailPage() {
  const params = useParams<{ id: string }>();
  const idText = params.id;
  const id = /^\d+$/.test(idText ?? "") ? Number(idText) : 0;
  const validId = Number.isSafeInteger(id) && id > 0;
  const { address } = useAccount();
  const active = useActiveChain();
  const [unlocked, unlockButton] = usePrivateAccess();
  const rightQuery = useChainRead(["supply-detail", idText], async (client, deployment): Promise<SupplyRight | null> => {
    const total = await client.readContract({ address: deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "totalMinted" });
    if (BigInt(id) > total) return null;
    const [raw, owner] = await Promise.all([
      client.readContract({ address: deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "getSupplyRight", args: [BigInt(id)] }),
      client.readContract({ address: deployment.supplyRightNFT, abi: supplyRightNftAbi, functionName: "ownerOf", args: [BigInt(id)] }),
    ]);
    return { ...raw, id, owner, deliveryDeadline: Number(raw.deliveryDeadline), registeredAt: Number(raw.registeredAt), protectionId: Number(raw.protectionId), unit: hexToString(raw.unit).replace(/\0/g, "") || "MT", status: Number(raw.status) };
  }, { enabled: validId });
  const right = rightQuery.data;
  const privateList = useAgreements(unlocked && validId);
  const agreement = privateList.data?.find((item) => item.token_id === id || (right && item.po_hash.toLowerCase() === right.poRefHash.toLowerCase()));
  const agreementDetails = useAgreement(agreement?.id, unlocked);
  const documentIndex = useDocumentIndex([right?.poRefHash, right?.agreementHash, right?.supplierRefHash, right?.supplierAckHash], unlocked);
  const relatedDocuments = useDocuments({ contextKey: validId ? contextKey("supply", active.chainId, id) : undefined }, unlocked && validId);
  const protection = useChainRead(["supply-protection", right?.protectionId], (client, deployment) => client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "getProtection", args: [BigInt(right!.protectionId)] }), { enabled: !!right?.protectionId });
  const docFor = (hash: string) => agreementDetails.data?.documents.find((doc) => doc.sha256.toLowerCase() === hash.toLowerCase()) ?? documentIndex.map.get(hash.toLowerCase());
  const allDocuments = Array.from(new Map([...(agreementDetails.data?.documents ?? []), ...(relatedDocuments.data ?? [])].map((doc) => [doc.id, doc])).values());
  const header = <PageHeader title={validId ? `Supply Right #${id}` : "Supply Right"} eyebrow="Hak pasokan terverifikasi" description="Catatan publik dan lifecycle ditampilkan dari kontrak. Dokumen komersial dapat dibuka oleh wallet yang berwenang." actions={<Button variant="outline" asChild><Link href="/registry"><ArrowLeft className="size-4" />Registry</Link></Button>} />;
  if (!validId) return <div>{header}<EmptyState title="ID Supply Right tidak valid" description="Gunakan ID token berupa bilangan bulat positif." /></div>;
  if (active.configLoading) return <div>{header}<p className="text-sm text-muted-foreground">Memuat konfigurasi deployment…</p></div>;
  if (!active.deployment) return <div>{header}<EmptyState title="Kontrak belum tersedia pada jaringan ini" description="Pilih jaringan dengan deployment SupplyRight." /></div>;
  if (rightQuery.isLoading) return <div>{header}<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Membaca hak pasokan onchain…</p></div>;
  if (rightQuery.error) return <div>{header}<EmptyState title="Supply Right belum dapat dibaca" description={errorMessage(rightQuery.error)} action={<Button variant="outline" onClick={() => rightQuery.refetch()}>Coba lagi</Button>} /></div>;
  if (!right) return <div>{header}<EmptyState title="Supply Right tidak ditemukan" description={`Token #${id} belum dicetak pada jaringan aktif.`} /></div>;
  const deliveryRatio = right.orderedQuantity ? Number(right.deliveredQuantity * 10_000n / right.orderedQuantity) / 10_000 : 0;
  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center gap-3"><StatusBadge {...supplyStatusLabel[right.status]} /><NftLink contract={active.deployment.supplyRightNFT} tokenId={id}><span className="text-xs text-teal-700">Supply Right NFT</span></NftLink><Link href={`/verify?type=supply&id=${id}`} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">Verifikasi publik<ExternalLink className="size-3" /></Link></div>
      <div className="grid gap-4 sm:grid-cols-3"><KpiCard label="Nilai kontrak" value={formatToken(right.contractValue)} sub="Ketentuan ekonomi publik onchain" /><KpiCard label="Pesanan" value={formatQty(right.orderedQuantity, right.unit)} sub={`Diterima ${formatQty(right.deliveredQuantity, right.unit)}`} /><KpiCard label="Batas pengiriman" value={formatDateTime(right.deliveryDeadline)} sub={`Terdaftar ${formatDateTime(right.registeredAt)}`} /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Catatan Supply Right</CardTitle></CardHeader><CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2"><Field label="Wallet pembeli / beneficiary"><AddressChip address={right.buyer} /></Field><Field label="Pemilik NFT saat ini"><AddressChip address={right.owner} /></Field><Field label="Kontrak NFT"><AddressChip address={active.deployment.supplyRightNFT} /></Field><Field label="Jaringan">Chain ID {active.chainId}</Field></dl>
          <div><p className="mb-2 text-xs text-muted-foreground">Pengiriman terverifikasi · {(deliveryRatio * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%</p><Meter value={deliveryRatio} /></div>
          <dl className="space-y-3"><Field label="Hash Purchase Order"><DocumentHash hash={right.poRefHash} doc={docFor(right.poRefHash)} /></Field><Field label="Hash perjanjian"><DocumentHash hash={right.agreementHash} doc={docFor(right.agreementHash)} /></Field><Field label="Referensi pemasok salted"><DocumentHash hash={right.supplierRefHash} doc={docFor(right.supplierRefHash)} /></Field><Field label="Konfirmasi pemasok"><DocumentHash hash={right.supplierAckHash} doc={docFor(right.supplierAckHash)} /></Field></dl>
          <p className="text-xs text-muted-foreground">NFT adalah representasi digital atas perjanjian yang ada. Keberlakuan hukum mengikuti perjanjian bertanda tangan. Hash membuktikan kesesuaian dokumen; isi dokumen dan fakta pengiriman tetap membutuhkan pemeriksaan.</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Proteksi & klaim</CardTitle></CardHeader><CardContent className="space-y-4">
          {right.protectionId ? <>
            <p className="flex items-center gap-2 font-medium text-navy"><ShieldCheck className="size-4 text-teal-600" />Proteksi #{right.protectionId}</p>
            {protection.isLoading ? <p className="text-xs text-muted-foreground">Memuat posisi proteksi…</p> : protection.error ? <p className="text-sm text-rose-700">{errorMessage(protection.error)}</p> : protection.data && <><StatusBadge {...protectionStatusLabel[Number(protection.data.status) as keyof typeof protectionStatusLabel]} /><dl className="grid gap-4 sm:grid-cols-2"><Field label="Provider"><AddressChip address={protection.data.provider} /></Field><Field label="Coverage">{formatToken(protection.data.coverageAmount)} · {formatBps(Number(protection.data.coverageBps))}</Field><Field label="Kolateral terkunci">{formatToken(protection.data.lockedAmount)}</Field><Field label="Total dibayar">{formatToken(protection.data.paidAmount)}</Field><Field label="Berakhir">{formatDateTime(Number(protection.data.expiresAt))}</Field><Field label="Klaim terbuka">{protection.data.claimOpen ? "Ya" : "Tidak"}</Field></dl></>}
          </> : <p className="text-sm text-muted-foreground">Belum ada proteksi yang didanai untuk Supply Right ini.</p>}
          <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={`/protection?supply=${id}`}>{right.protectionId ? "Lihat proteksi" : "Ajukan proteksi"}</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/claims?supply=${id}`}>Klaim & settlement</Link></Button></div>
          <p className="text-xs text-muted-foreground">Settlement menggunakan MockETH (mETH, 18 desimal). mETH demo tidak mewakili dana atau aset mainnet.</p>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Data komersial & dokumen privat</CardTitle></CardHeader><CardContent className="space-y-4">
        {!unlocked ? <EmptyState title={address ? "Buka dokumen privat" : "Hubungkan wallet untuk mengakses dokumen"} description="Nama pemasok, harga pada dokumen, dan berkas tersimpan di Supabase dengan akses sesuai wallet/peran. Login memerlukan tanda tangan pesan tanpa gas." action={unlockButton} /> : <>
          {(privateList.isLoading || agreementDetails.isLoading) && <p className="text-sm text-muted-foreground">Memuat metadata dan dokumen privat…</p>}
          {privateList.error && <p className="text-sm text-rose-700">{errorMessage(privateList.error)} <button className="underline" onClick={() => privateList.refetch()}>Coba lagi</button></p>}
          {agreementDetails.error && <p className="text-sm text-rose-700">{errorMessage(agreementDetails.error)}</p>}
          {documentIndex.error && <p className="text-xs text-rose-700">Metadata hash tidak dapat dimuat: {errorMessage(documentIndex.error)}</p>}
          {relatedDocuments.error && <p className="text-xs text-rose-700">Dokumen lifecycle tidak dapat dimuat: {errorMessage(relatedDocuments.error)}</p>}
          {agreement && <dl className="grid gap-4 sm:grid-cols-3"><Field label="Nomor PO">{agreement.po_number}</Field><Field label="Pembeli">{agreement.buyer_name}</Field><Field label="Pemasok">{agreement.supplier_name}</Field><Field label="Material">{agreement.material_name} · {agreement.material_code}</Field><Field label="Referensi pemasok">{agreement.supplier_ref}</Field><Field label="Incoterms">{agreement.incoterms || "—"}</Field>{agreement.notes && <Field label="Catatan" className="sm:col-span-3"><span className="whitespace-pre-wrap">{agreement.notes}</span></Field>}</dl>}
          {!agreement && !privateList.isLoading && !privateList.error && <p className="text-sm text-muted-foreground">Tidak ada perjanjian privat yang dapat ditautkan pada daftar wallet ini (maksimal 200 perjanjian terbaru). Hak pasokan publik tetap dapat diverifikasi.</p>}
          {!!allDocuments.length && <div className="space-y-2 border-t pt-3">{allDocuments.map((doc) => <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3"><DocumentHash hash={doc.sha256} doc={doc} /><span className="text-[10px] text-muted-foreground">{doc.kind}</span></div>)}</div>}
        </>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Aksi registrar</CardTitle></CardHeader><CardContent><LifecycleActions key={`${active.chainId}:${address}:${right.id}`} right={right} agreement={agreement} unlocked={unlocked} existingAck={agreement?.supplier_ack_hash ? docFor(agreement.supplier_ack_hash) : undefined} /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Jejak audit onchain</CardTitle></CardHeader><CardContent><AuditTimeline supplyRightId={id} limit={100} /></CardContent></Card>
    </div>
  );
}

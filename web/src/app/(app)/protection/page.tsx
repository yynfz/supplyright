"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, zeroAddress, type Address } from "viem";
import { ShieldCheck, LockKeyhole, Wallet, AlertTriangle } from "lucide-react";
import { vaultAbi } from "@/generated/abis";
import { useActiveChain, useProtocolSnapshot } from "@/hooks/use-protocol";
import { useDocumentIndex } from "@/hooks/use-offchain";
import { AuditTimeline } from "@/components/audit-timeline";
import { AddressChip } from "@/components/onchain";
import { EmptyState, Field, KpiCard, Meter, PageHeader } from "@/components/page";
import { DocumentHash, DocumentUpload, PrivateDataNotice, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { TxStatus } from "@/components/tx-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBps, formatDateTime, formatToken } from "@/lib/format";
import { contextKey, type StoredDocument } from "@/lib/offchain-types";
import { protectionClaimStatusLabel, protectionStatusLabel } from "@/lib/protocol/labels";
import { ROLES } from "@/lib/protocol/roles";
import { ProtectionStatus, RequestStatus, SupplyStatus } from "@/lib/protocol/types";
import { exactAmount, ProtectionRequests, sameAccount, selectClass, usePageTransactions } from "./_components/protection-actions";

const MAX_WINDOW = 365 * 86400;

export default function ProtectionPage() {
  const { address } = useAccount();
  const { deployment, chainId, wrongNetwork, configLoading } = useActiveChain();
  const client = usePublicClient({ chainId });
  const snapshot = useProtocolSnapshot();
  const [unlocked, unlockButton] = usePrivateAccess();
  const actions = usePageTransactions();
  const [scope, setScope] = useState("all");
  const [supplyId, setSupplyId] = useState("");
  const [provider, setProvider] = useState("");
  const [coverage, setCoverage] = useState("");
  const [percentage, setPercentage] = useState("80");
  const [expiry, setExpiry] = useState("");
  const [terms, setTerms] = useState<StoredDocument | null>(null);
  const snap = snapshot.data;
  const now = snap?.blockTimestamp ?? 0;
  const candidates = (snap?.supplyRights ?? []).filter(r => sameAccount(r.buyer, address) && sameAccount(r.owner, address) && [SupplyStatus.Registered, SupplyStatus.Active].includes(r.status) && r.protectionId === 0 && !snap?.requests.some(q => q.supplyRightId === r.id && q.status === RequestStatus.Pending));
  const selected = candidates.find(r => String(r.id) === supplyId);
  const positions = (snap?.protections ?? []).filter(p => scope !== "mine" || sameAccount(p.beneficiary, address) || sameAccount(p.provider, address));
  const requests = (snap?.requests ?? []).filter(r => scope === "pending" ? r.status === RequestStatus.Pending : scope !== "mine" || sameAccount(r.buyer, address) || sameAccount(r.provider, address)).slice().reverse();
  const docs = useDocumentIndex(positions.map(p => p.termsHash), unlocked);
  const active = (snap?.protections ?? []).filter(p => p.status === ProtectionStatus.Active && p.expiresAt >= now);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("supply");
    if (query && /^\d+$/.test(query)) setSupplyId(query);
  }, []);
  useEffect(() => { setTerms(null); setCoverage(""); setExpiry(""); }, [supplyId, chainId, address]);

  const submit = () => actions.run(async () => {
    if (!selected || !deployment || !client || !address || !snap || wrongNetwork) throw new Error("Pilih Supply Right milik wallet Anda pada jaringan yang tersedia.");
    if (!unlocked || !terms) throw new Error("Unggah dokumen syarat proteksi terlebih dahulu.");
    const amount = exactAmount(coverage);
    const bps = exactAmount(percentage, 2);
    if (amount === 0n || amount > selected.contractValue) throw new Error("Batas kompensasi harus lebih dari nol dan tidak melebihi nilai kontrak.");
    if (bps === 0n || bps > 10000n) throw new Error("Porsi kompensasi harus di atas 0% dan maksimal 100%.");
    const expiresAt = Math.floor(new Date(expiry).getTime() / 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= selected.deliveryDeadline || expiresAt > selected.deliveryDeadline + MAX_WINDOW || expiresAt <= now) throw new Error("Masa proteksi harus setelah tenggat dan waktu chain saat ini, maksimal 365 hari setelah tenggat pengiriman.");
    const designated = provider.trim() || zeroAddress;
    if (!isAddress(designated)) throw new Error("Alamat provider tidak valid.");
    if (!sameAccount(designated, zeroAddress)) {
      if (sameAccount(designated, address)) throw new Error("Provider harus berbeda dari buyer.");
      const authorized = await client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "hasRole", args: [ROLES.PROVIDER_ROLE, designated as Address] });
      if (!authorized) throw new Error("Alamat yang dipilih belum memiliki PROVIDER_ROLE pada vault.");
    }
    const receipt = await actions.tx.send({ label: "Ajukan proteksi pasokan", address: deployment.vault, abi: vaultAbi, functionName: "requestProtection", args: [BigInt(selected.id), designated, amount, Number(bps), BigInt(expiresAt), terms.sha256] });
    if (receipt) { setSupplyId(""); setTerms(null); }
  });

  const unavailable = configLoading || snapshot.isLoading ? "Membaca konfigurasi dan kontrak…" : !deployment ? "Kontrak belum tersedia pada jaringan ini" : snapshot.error ? "Gagal membaca kontrak" : !snap ? "Data protokol belum tersedia" : null;
  return <>
    <PageHeader title="Protection Center" eyebrow="Proteksi berjaminan collateral" description="Ajukan proteksi, tinjau keputusan provider, dan pantau collateral serta kompensasi setiap pasokan." actions={<Button asChild variant="outline" size="sm"><Link href="/provider">Dashboard Provider</Link></Button>} />
    {wrongNetwork && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Wallet berada di jaringan yang tidak didukung. Ganti ke jaringan protokol sebelum bertransaksi.</p>}
    {unavailable ? <EmptyState icon={AlertTriangle} title={unavailable} description={snapshot.error ? (snapshot.error as Error).message : "Data akan muncul setelah konfigurasi kontrak dan RPC siap."} action={snapshot.error ? <Button variant="outline" onClick={() => snapshot.refetch()}>Coba lagi</Button> : undefined} /> : <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShieldCheck} label="Proteksi aktif" value={active.length} sub="Dalam masa berlaku" />
        <KpiCard icon={LockKeyhole} label="Collateral terkunci" value={formatToken(snap?.vault.totalLocked)} sub="Dana yang menjamin kompensasi" tone="teal" />
        <KpiCard icon={Wallet} label="Kompensasi dibayar" value={formatToken(snap?.vault.totalPaidOut)} sub="Total payout onchain" />
        <KpiCard label="Permintaan tertunda" value={snap?.requests.filter(r => r.status === RequestStatus.Pending).length ?? 0} sub="Menunggu keputusan provider" tone="warning" />
      </div>
      {!unlocked && <PrivateDataNotice action={unlockButton} />}
      <Card className="mt-6">
        <CardHeader><CardTitle>Ajukan proteksi</CardTitle><CardDescription>Buyer yang juga memegang Supply Right dapat mengajukan. Maksimum payout didanai penuh saat provider menyetujui.</CardDescription></CardHeader>
        <CardContent>
          {!address ? <EmptyState title="Hubungkan wallet buyer" description="Wallet digunakan untuk membuktikan kepemilikan Supply Right dan menandatangani permintaan." /> : !candidates.length ? <EmptyState title="Belum ada Supply Right yang dapat diproteksi" description="Supply Right harus terdaftar / aktif, dimiliki buyer, belum diproteksi, dan tidak memiliki permintaan tertunda." action={<Button asChild variant="outline"><Link href="/registry">Buka Registry</Link></Button>} /> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit(); }}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="protect-supply">Supply Right</Label><select id="protect-supply" className={selectClass} value={supplyId} disabled={actions.busy} onChange={e => setSupplyId(e.target.value)} required><option value="">Pilih pasokan</option>{candidates.map(r => <option key={r.id} value={r.id}>SR #{r.id} · {formatToken(r.contractValue)}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="protect-provider">Alamat provider (opsional)</Label><Input id="protect-provider" placeholder="Kosong = semua provider berizin" value={provider} onChange={e => setProvider(e.target.value)} disabled={actions.busy} /></div>
              <div className="space-y-1.5"><Label htmlFor="protect-coverage">Batas total kompensasi (ETH)</Label><Input id="protect-coverage" inputMode="decimal" placeholder="Contoh: 0.01" value={coverage} onChange={e => setCoverage(e.target.value)} required disabled={actions.busy} /></div>
              <div className="space-y-1.5"><Label htmlFor="protect-percentage">Porsi kerugian yang ditanggung (%)</Label><Input id="protect-percentage" inputMode="decimal" value={percentage} onChange={e => setPercentage(e.target.value)} required disabled={actions.busy} /></div>
              <div className="space-y-1.5"><Label htmlFor="protect-expiry">Berlaku sampai</Label><Input id="protect-expiry" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} required disabled={actions.busy} /></div>
            </div>
            {selected && <p className="text-xs text-muted-foreground">Tenggat pengiriman: {formatDateTime(selected.deliveryDeadline)}. Masa klaim berakhir setelah tenggat dan paling lambat {formatDateTime(selected.deliveryDeadline + MAX_WINDOW)}. Jumlah payout = porsi kerugian terverifikasi, dibatasi sisa coverage dan collateral.</p>}
            <DocumentUpload kind="PROTECTION_TERMS" contextKey={selected ? contextKey("supply", chainId, selected.id) : undefined} value={terms} onUploaded={setTerms} disabled={!unlocked || !selected || actions.busy} />
            <Button type="submit" disabled={actions.busy || !selected || !terms || !unlocked || wrongNetwork}>Ajukan permintaan onchain</Button>
          </form>}
        </CardContent>
      </Card>
      <TxStatus state={actions.tx.state} className="mt-4" />
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-navy">Permintaan proteksi</h2><label className="flex items-center gap-2 text-sm">Tampilkan<select aria-label="Filter proteksi" className={selectClass} value={scope} onChange={e => setScope(e.target.value)}><option value="all">Semua</option><option value="mine">Wallet saya</option><option value="pending">Permintaan tertunda</option></select></label></div>
      <ProtectionRequests requests={requests} unlocked={unlocked} actions={actions} />
      <h2 className="mb-3 mt-8 font-semibold text-navy">Posisi proteksi & NFT</h2>
      {docs.error && <p className="mb-3 text-sm text-rose-700">Dokumen privat: {(docs.error as Error).message}</p>}
      {!positions.length ? <EmptyState title="Belum ada posisi proteksi" description="Posisi dan Protection NFT muncul setelah provider mengunci seluruh coverage." /> : <div className="grid gap-4 xl:grid-cols-2">{positions.slice().reverse().map(p => {
        const used = p.coverageAmount > 0n ? Number(p.paidAmount * 10000n / p.coverageAmount) / 10000 : 0;
        const expired = now > p.expiresAt;
        return <Card key={p.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Proteksi #{p.id} · SR #{p.supplyRightId}</CardTitle><StatusBadge {...protectionStatusLabel[p.status]} /></div></CardHeader><CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Provider"><AddressChip address={p.provider} /></Field><Field label="Penerima kompensasi"><AddressChip address={p.beneficiary} /></Field><Field label="Pemegang NFT"><AddressChip address={p.nftOwner} /></Field><Field label="Batas coverage">{formatToken(p.coverageAmount)} · {formatBps(p.coverageBps)}</Field><Field label="Terkunci saat ini">{formatToken(p.lockedAmount)}</Field><Field label="Kompensasi dibayar">{formatToken(p.paidAmount)}</Field><Field label="Dilepas ke saldo bebas">{formatToken(p.releasedAmount)}</Field><Field label="Berlaku sampai"><span className={expired ? "text-amber-700" : ""}>{formatDateTime(p.expiresAt)}{expired && " · berakhir"}</span></Field><Field label="Klaim"><StatusBadge {...protectionClaimStatusLabel[p.nftClaimStatus]} /></Field><Field label="Syarat proteksi"><DocumentHash hash={p.termsHash} doc={docs.map.get(p.termsHash.toLowerCase())} /></Field></dl>
          <div><Meter value={used} /><p className="mt-1 text-xs text-muted-foreground">{(used * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}% coverage telah dibayarkan</p></div>
          <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link href={`/supply/${p.supplyRightId}`}>Detail pasokan</Link></Button><Button asChild variant="outline" size="sm"><Link href={`/verify?type=protection&id=${p.id}`}>Verifikasi NFT</Link></Button>{sameAccount(p.beneficiary, address) && p.status === ProtectionStatus.Active && <Button asChild size="sm"><Link href={`/claims?supply=${p.supplyRightId}`}>Buka klaim</Link></Button>}</div>
        </CardContent></Card>;
      })}</div>}
      <Card className="mt-6"><CardHeader><CardTitle>Riwayat proteksi onchain</CardTitle></CardHeader><CardContent><AuditTimeline filter={e => e.contract === "vault" || e.contract === "protectionNFT"} limit={25} /></CardContent></Card>
    </>}
  </>;
}

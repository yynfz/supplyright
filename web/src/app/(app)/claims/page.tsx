"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { formatUnits, maxUint256, parseUnits, type Hex } from "viem";
import { AlertTriangle, Banknote, FileWarning, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { claimManagerAbi, vaultAbi } from "@/generated/abis";
import { AuditTimeline } from "@/components/audit-timeline";
import { AddressChip, HashChip, TxLink } from "@/components/onchain";
import { EmptyState, Field, KpiCard, PageHeader, SectionTitle } from "@/components/page";
import { DocumentHash, DocumentUpload, PrivateDataNotice, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { TxStatus } from "@/components/tx-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useChainRead } from "@/hooks/claims-chain-read";
import { useCreateTextDocument, useDocumentIndex } from "@/hooks/use-offchain";
import { useActiveChain, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { useProtocolTx } from "@/hooks/use-protocol-tx";
import { formatBps, formatDateTime, formatQty, formatToken, isZeroHash, TOKEN_DECIMALS } from "@/lib/format";
import { contextKey, type DocumentKind, type StoredDocument } from "@/lib/offchain-types";
import { decodeProtocolLog } from "@/lib/protocol/events";
import { claimStatusLabel, defaultTypeLabel, supplyStatusLabel } from "@/lib/protocol/labels";
import { ClaimStatus, DefaultType, ProtectionStatus, QTY_DECIMALS, SupplyStatus, type Claim, type Protection, type ProtocolSnapshot, type SupplyRight } from "@/lib/protocol/types";

const SELECT = "h-9 w-full rounded-md border bg-white px-3 text-sm disabled:opacity-50";
const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const minimum = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);

/** Reject excess precision rather than silently rounding viem's parseUnits. */
function exactAmount(input: string, decimals: number): bigint | null {
  const clean = input.trim().replace(",", ".");
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(clean)) return null;
  try { const value = parseUnits(clean, decimals); return value <= maxUint256 ? value : null; } catch { return null; }
}

function lossCap(right: SupplyRight, delivered: bigint, claims: Claim[]) {
  if (right.orderedQuantity === 0n || delivered >= right.orderedQuantity) return 0n;
  const undelivered = (right.orderedQuantity - delivered) * right.contractValue / right.orderedQuantity;
  const settled = claims.filter((c) => c.supplyRightId === right.id && c.status === ClaimStatus.Settled).reduce((sum, c) => sum + c.approvedLoss, 0n);
  return undelivered > settled ? undelivered - settled : 0n;
}

function eligibility(right: SupplyRight | undefined, p: Protection, now: number, address?: string) {
  if (!sameAddress(address, p.beneficiary)) return "Wallet ini bukan beneficiary proteksi.";
  if (!right) return "Supply Right belum dapat dibaca.";
  if (![SupplyStatus.Active, SupplyStatus.Defaulted].includes(right.status)) return "Supply Right harus aktif atau default dengan sisa kerugian.";
  if (now <= right.deliveryDeadline) return "Tenggat pengiriman belum terlewati.";
  if (p.status !== ProtectionStatus.Active || p.lockedAmount === 0n) return "Proteksi tidak aktif atau collateral telah habis.";
  if (p.claimOpen) return "Masih ada klaim terbuka pada proteksi ini.";
  if (now < p.startsAt || now > p.expiresAt) return "Di luar periode pengajuan proteksi.";
  if (right.deliveredQuantity >= right.orderedQuantity) return "Seluruh kuantitas telah terkirim.";
  return null;
}

export default function ClaimsPage() {
  return <Suspense fallback={<Skeleton className="h-64" />}><ClaimsRoute /></Suspense>;
}

function ClaimsRoute() {
  const params = useSearchParams();
  return <ClaimsContent key={params.toString()} />;
}

function ClaimsContent() {
  const params = useSearchParams();
  const { address } = useAccount();
  const active = useActiveChain();
  const snapshot = useProtocolSnapshot();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedProtection, setSelectedProtection] = useState("");
  const [unlocked, unlockButton] = usePrivateAccess();
  const snap = snapshot.data;
  const supplyParam = Number(params.get("supply")) || undefined;
  const claimParam = Number(params.get("claim")) || undefined;
  const claims = (snap?.claims ?? []).filter((c) => (!supplyParam || c.supplyRightId === supplyParam) && (filter === "all" || (filter === "mine" ? sameAddress(address, c.claimant) : c.status === Number(filter))));
  const current = snap?.claims.find((c) => c.id === (selected ?? claimParam)) ?? claims[0];
  const ownedPositions = (snap?.protections ?? []).filter((p) => sameAddress(address, p.beneficiary) && (!supplyParam || p.supplyRightId === supplyParam));
  const defaultPosition = ownedPositions.find((p) => !eligibility(snap?.supplyRights.find((r) => r.id === p.supplyRightId), p, snap?.blockTimestamp ?? 0, address)) ?? ownedPositions[0];
  const position = ownedPositions.find((p) => String(p.id) === selectedProtection) ?? defaultPosition;
  const right = snap?.supplyRights.find((r) => r.id === position?.supplyRightId);

  return <>
    <PageHeader eyebrow="Default & penyelesaian" title="Claims Center" description="Bukti privat, keputusan verifikator independen, dan settlement yang mengirim kompensasi sekaligus mencetak Recovery Claim NFT dalam satu transaksi." actions={<Button variant="outline" size="sm" onClick={() => snapshot.refetch()} disabled={!active.deployment || snapshot.isFetching}><RefreshCw className="size-4" />Muat ulang</Button>} />
    {active.configLoading ? <Skeleton className="h-24" /> : !active.deployment ? <EmptyState title="Kontrak belum tersedia pada jaringan ini" description="Pilih jaringan dengan deployment SupplyRight untuk membaca atau mengirim klaim." /> : snapshot.isLoading ? <Skeleton className="h-64" /> : snapshot.error ? <EmptyState icon={AlertTriangle} title="Gagal membaca kontrak" description={(snapshot.error as Error).message} /> : snap ? <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Perlu keputusan" value={snap.claims.filter((c) => [ClaimStatus.Submitted, ClaimStatus.Disputed].includes(c.status)).length} icon={FileWarning} tone="warning" />
        <KpiCard label="Siap / menunggu settlement" value={snap.claims.filter((c) => c.status === ClaimStatus.Approved).length} icon={ShieldCheck} tone="teal" />
        <KpiCard label="Kompensasi diselesaikan" value={formatToken(snap.claims.filter((c) => c.status === ClaimStatus.Settled).reduce((sum, c) => sum + c.payoutAmount, 0n))} icon={Banknote} tone="success" />
      </div>
      <PrivateDataNotice action={!unlocked && unlockButton} />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Daftar klaim{supplyParam ? ` · SR #${supplyParam}` : ""}</CardTitle><CardDescription>Klik klaim untuk membaca bukti hash dan langkah berikutnya.</CardDescription></CardHeader>
            <CardContent>
              <Label htmlFor="claims-filter" className="mb-2 block">Tampilkan</Label>
              <select id="claims-filter" className={SELECT} value={filter} onChange={(e) => { setFilter(e.target.value); setSelected(null); }}>
                <option value="all">Semua klaim</option><option value="mine">Klaim saya</option>
                {Object.entries(claimStatusLabel).filter(([key]) => Number(key) !== 0).map(([key, label]) => <option key={key} value={key}>{label.label}</option>)}
              </select>
              {claims.length === 0 ? <div className="mt-4"><EmptyState title="Belum ada klaim pada filter ini" description="Tenggat lewat membuka pengajuan; kompensasi tetap membutuhkan verifikasi." /></div> : <Table className="mt-3"><TableHeader><TableRow><TableHead>Klaim</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Kerugian</TableHead></TableRow></TableHeader><TableBody>{[...claims].reverse().map((c) => <TableRow key={c.id} className={current?.id === c.id ? "bg-teal-50/60" : ""}><TableCell><button className="text-left font-medium text-teal-700 hover:underline" onClick={() => setSelected(c.id)}>Klaim #{c.id}</button><p className="text-xs text-muted-foreground">SR #{c.supplyRightId} · {defaultTypeLabel[c.claimedType]}</p></TableCell><TableCell><StatusBadge {...claimStatusLabel[c.status]} /></TableCell><TableCell className="text-right tabular">{formatToken(c.claimedLoss)}</TableCell></TableRow>)}</TableBody></Table>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Ajukan default</CardTitle><CardDescription>Beneficiary proteksi mengajukan jumlah terkirim kumulatif dan kerugian yang dapat dibuktikan.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {!address ? <EmptyState title="Hubungkan wallet beneficiary" /> : ownedPositions.length === 0 ? <EmptyState title="Belum ada proteksi untuk wallet ini" action={<Button asChild size="sm"><Link href="/protection">Buka proteksi</Link></Button>} /> : <>
                <Label htmlFor="claim-protection">Proteksi</Label><select id="claim-protection" className={SELECT} value={String(position?.id ?? "")} onChange={(e) => setSelectedProtection(e.target.value)}>{ownedPositions.map((p) => <option key={p.id} value={p.id}>Proteksi #{p.id} · SR #{p.supplyRightId}{eligibility(snap.supplyRights.find((r) => r.id === p.supplyRightId), p, snap.blockTimestamp, address) ? " · belum eligible" : " · eligible"}</option>)}</select>
                {right && position && <SubmitClaim key={`${position.id}:${address}`} right={right} position={position} snapshot={snap} unlocked={unlocked} />}
              </>}
            </CardContent>
          </Card>
        </div>
        {current ? <ClaimDetail key={`${current.id}:${address}`} claim={current} snapshot={snap} unlocked={unlocked} /> : <EmptyState title="Pilih klaim untuk melihat detail" />}
      </div>
    </> : <EmptyState title="Menunggu data onchain" />}
  </>;
}

function SubmitClaim({ right, position, snapshot, unlocked }: { right: SupplyRight; position: Protection; snapshot: ProtocolSnapshot; unlocked: boolean }) {
  const { address } = useAccount();
  const { chainId, deployment, wrongNetwork } = useActiveChain();
  const tx = useProtocolTx();
  const [type, setType] = useState(right.deliveredQuantity > 0n ? DefaultType.Partial : DefaultType.Complete);
  const [deliveredText, setDeliveredText] = useState(formatUnits(right.deliveredQuantity, QTY_DECIMALS));
  const [lossText, setLossText] = useState("");
  const [evidence, setEvidence] = useState<StoredDocument | null>(null);
  const delivered = type === DefaultType.Complete ? 0n : exactAmount(deliveredText, QTY_DECIMALS);
  const loss = exactAmount(lossText, TOKEN_DECIMALS);
  const cap = delivered === null ? 0n : lossCap(right, delivered, snapshot.claims);
  const guard = useChainRead(["claim-submit-guard", position.id, evidence?.sha256], async (client, d) => {
    const [open, used] = await Promise.all([
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "activeClaimOf", args: [BigInt(position.id)] }),
      evidence ? client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "evidenceUsed", args: [evidence.sha256] }) : Promise.resolve(false),
    ]);
    return { open, used };
  });
  const ineligible = eligibility(right, position, snapshot.blockTimestamp, address);
  const quantityError = delivered === null ? "Gunakan kuantitas positif dengan maksimal 3 desimal." : delivered < right.deliveredQuantity || delivered >= right.orderedQuantity ? "Jumlah terkirim harus minimal catatan onchain dan lebih kecil dari jumlah dipesan." : type === DefaultType.Partial && delivered === 0n ? "Default sebagian harus memiliki kuantitas terkirim lebih dari nol." : null;
  const lossError = loss === null ? "Isi kerugian mETH, maksimal 18 desimal." : loss <= 0n || loss > cap ? "Kerugian harus lebih dari nol dan tidak melebihi batas yang tersisa." : null;
  const reason = ineligible ?? quantityError ?? lossError ?? (!evidence ? "Unggah bukti privat sebelum mengajukan." : null) ?? (guard.data?.open !== 0n ? "Klaim aktif masih ada atau pemeriksaan RPC belum selesai." : null) ?? (guard.data?.used ? "Bukti ini sudah dipakai untuk klaim lain. Unggah bundel baru." : null);
  async function submit() {
    if (reason || !deployment || delivered === null || loss === null || !evidence) return;
    const receipt = await tx.send({ label: "Ajukan klaim", address: deployment.claimManager, abi: claimManagerAbi, functionName: "submitClaim", args: [BigInt(position.id), type, loss, delivered, evidence.sha256] });
    if (receipt) { setEvidence(null); setLossText(""); }
  }
  return <div className="space-y-4">
    <dl className="grid gap-3 sm:grid-cols-2"><Field label="Supply Right"><Link className="text-teal-700 hover:underline" href={`/supply/${right.id}`}>SR #{right.id}</Link> · <StatusBadge {...supplyStatusLabel[right.status]} /></Field><Field label="Tenggat pengiriman">{formatDateTime(right.deliveryDeadline)}</Field><Field label="Terkirim / dipesan">{formatQty(right.deliveredQuantity, right.unit)} / {formatQty(right.orderedQuantity, right.unit)}</Field><Field label="Batas akhir pengajuan">{formatDateTime(position.expiresAt)}</Field></dl>
    {ineligible && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{ineligible}</p>}
    <div><Label htmlFor="default-type">Jenis default yang dilaporkan</Label><select id="default-type" className={`${SELECT} mt-2`} value={type} onChange={(e) => setType(Number(e.target.value))}><option value={DefaultType.Complete}>Penuh · tidak ada pengiriman</option><option value={DefaultType.Partial}>Sebagian · ada pengiriman</option></select></div>
    {type === DefaultType.Partial && <div><Label htmlFor="reported-delivered">Kuantitas terkirim kumulatif ({right.unit})</Label><Input id="reported-delivered" className="mt-2" inputMode="decimal" value={deliveredText} onChange={(e) => setDeliveredText(e.target.value)} /></div>}
    <div><Label htmlFor="claimed-loss">Kerugian yang diajukan (mETH)</Label><Input id="claimed-loss" className="mt-2" inputMode="decimal" placeholder="0.0" value={lossText} onChange={(e) => setLossText(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Batas kerugian tersisa: {formatToken(cap)}. Kerugian yang pernah diselesaikan sudah dikurangi.</p></div>
    {unlocked ? <DocumentUpload kind="CLAIM_EVIDENCE" contextKey={contextKey("protection", chainId, position.id)} value={evidence} onUploaded={setEvidence} disabled={tx.busy} /> : <p className="text-xs text-muted-foreground">Buka data privat untuk mengunggah bukti dengan tanda tangan login wallet.</p>}
    {guard.error && <p className="text-sm text-rose-700">Pemeriksaan klaim gagal: {(guard.error as Error).message}</p>}
    {reason && !ineligible && <p className="text-xs text-muted-foreground">{reason}</p>}
    <Button onClick={submit} disabled={!!reason || !!guard.error || tx.busy || wrongNetwork || !deployment}>Ajukan untuk verifikasi</Button><TxStatus state={tx.state} />
  </div>;
}

function ClaimDetail({ claim, snapshot, unlocked }: { claim: Claim; snapshot: ProtocolSnapshot; unlocked: boolean }) {
  const { address } = useAccount();
  const { chainId, deployment, wrongNetwork } = useActiveChain();
  const roles = useRoles(address);
  const tx = useProtocolTx();
  const right = snapshot.supplyRights.find((r) => r.id === claim.supplyRightId);
  const position = snapshot.protections.find((p) => p.id === claim.protectionId);
  const [verifiedText, setVerifiedText] = useState(formatUnits(claim.reportedDeliveredQuantity, QTY_DECIMALS));
  const [approvedText, setApprovedText] = useState(formatUnits(claim.claimedLoss, TOKEN_DECIMALS));
  const [report, setReport] = useState<StoredDocument | null>(null);
  const [rejectReport, setRejectReport] = useState<StoredDocument | null>(null);
  const [publicReason, setPublicReason] = useState("");
  const [objection, setObjection] = useState<StoredDocument | null>(null);
  const [confirmedSettlement, setConfirmedSettlement] = useState<{ hash: Hex; payout: bigint; recoveryId: bigint; beneficiary: string; provider: string; reference: Hex } | null>(null);
  const docs = useDocumentIndex([claim.evidenceHash, claim.decisionHash, claim.objectionHash], unlocked);
  const guard = useChainRead(["claim-detail-guard", claim.id, claim.protectionId], async (client, d) => {
    const [appealDeadline, open, history] = await Promise.all([
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "appealDeadlineOf", args: [BigInt(claim.protectionId)] }),
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "activeClaimOf", args: [BigInt(claim.protectionId)] }),
      client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "claimsOfSupplyRight", args: [BigInt(claim.supplyRightId)] }),
    ]);
    return { appealDeadline: Number(appealDeadline), open, latest: history[history.length - 1] };
  });
  const verified = exactAmount(verifiedText, QTY_DECIMALS);
  const approved = exactAmount(approvedText, TOKEN_DECIMALS);
  const cap = right && verified !== null ? minimum(lossCap(right, verified, snapshot.claims), claim.claimedLoss) : 0n;
  const quote = useChainRead(["claim-quote", claim.protectionId, approved?.toString()], (client, d) => client.readContract({ address: d.vault, abi: vaultAbi, functionName: "quotePayout", args: [BigInt(claim.protectionId), approved ?? 0n] }), { enabled: approved !== null && approved > 0n });
  const independent = !!address && !!right && !!position && !sameAddress(address, claim.claimant) && !sameAddress(address, right.buyer) && !sameAddress(address, position.provider);
  const canDecide = !!roles.data?.verifier && independent && [ClaimStatus.Submitted, ClaimStatus.Disputed].includes(claim.status);
  const approvalError = !right || verified === null || verified < right.deliveredQuantity || verified >= right.orderedQuantity ? "Kuantitas verifikasi harus minimal catatan onchain, kurang dari dipesan, maksimal 3 desimal." : approved === null || approved <= 0n || approved > cap ? `Kerugian eligible harus lebih dari nol dan maksimal ${formatToken(cap)} (18 desimal).` : !quote.data || quote.data <= 0n ? "Quote payout belum tersedia atau sisa coverage nol." : !report ? "Laporan verifikator privat wajib diunggah." : null;
  const readyAt = claim.decidedAt + snapshot.settings.settlementDelay;
  const now = snapshot.blockTimestamp;
  const claimant = sameAddress(address, claim.claimant);
  const provider = sameAddress(address, position?.provider);
  const noObjection = isZeroHash(claim.objectionHash);
  const canAppeal = claimant && claim.status === ClaimStatus.Rejected && noObjection && !!guard.data && now <= guard.data.appealDeadline && guard.data.latest === BigInt(claim.id) && guard.data.open === 0n && position?.status === ProtectionStatus.Active && !position.claimOpen && !!right && [SupplyStatus.Active, SupplyStatus.Defaulted].includes(right.status);
  // Approved objections remain valid until settlement, even if the minimum delay has elapsed.
  const canObject = noObjection && ((claim.status === ClaimStatus.Approved && (claimant || provider)) || canAppeal);
  const canWithdraw = claimant && [ClaimStatus.Submitted, ClaimStatus.Approved, ClaimStatus.Disputed].includes(claim.status);
  const settlementCap = right ? lossCap(right, claim.verifiedDeliveredQuantity, snapshot.claims) : 0n;
  const canSettle = claim.status === ClaimStatus.Approved && now >= readyAt && !!position && right?.status === SupplyStatus.UnderAssessment && claim.approvedLoss <= settlementCap && claim.payoutAmount <= position.lockedAmount && claim.payoutAmount <= position.coverageAmount - position.paidAmount;
  const disabled = tx.busy || !address || !deployment || wrongNetwork;
  async function act(functionName: string, args: readonly unknown[], label: string) {
    if (disabled || !deployment) return;
    const receipt = await tx.send({ label, address: deployment.claimManager, abi: claimManagerAbi, functionName, args });
    if (receipt && functionName === "settleClaim") {
      for (const log of receipt.logs) {
        const event = decodeProtocolLog(deployment, log);
        if (event?.contract === "claimManager" && event.name === "ClaimSettled" && event.args.claimId === BigInt(claim.id)) {
          setConfirmedSettlement({ hash: receipt.transactionHash, payout: event.args.payoutAmount as bigint, recoveryId: event.args.recoveryTokenId as bigint, beneficiary: event.args.beneficiary as string, provider: event.args.provider as string, reference: event.args.settlementRef as Hex });
        }
      }
    }
  }
  if (!right || !position) return <EmptyState title="Detail terkait belum dapat dibaca" />;
  return <div className="space-y-6">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Klaim #{claim.id}</CardTitle><StatusBadge {...claimStatusLabel[claim.status]} /></div><CardDescription><Link href={`/supply/${right.id}`} className="text-teal-700 hover:underline">Supply Right #{right.id}</Link> · Proteksi #{position.id}</CardDescription></CardHeader><CardContent className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2"><Field label="Pemohon"><AddressChip address={claim.claimant} /></Field><Field label="Provider"><AddressChip address={position.provider} /></Field><Field label="Beneficiary payout"><AddressChip address={position.beneficiary} /></Field><Field label="Verifikator"><AddressChip address={claim.verifier} /></Field><Field label="Diajukan">{formatDateTime(claim.submittedAt)}</Field><Field label="Default dilaporkan">{defaultTypeLabel[claim.claimedType]}</Field><Field label="Terkirim yang dilaporkan">{formatQty(claim.reportedDeliveredQuantity, right.unit)}</Field><Field label="Kerugian diajukan">{formatToken(claim.claimedLoss)}</Field><Field label="Bukti privat / hash"><DocumentHash hash={claim.evidenceHash} doc={docs.map.get(claim.evidenceHash.toLowerCase())} /></Field><Field label="Keputusan / hash"><DocumentHash hash={claim.decisionHash} doc={docs.map.get(claim.decisionHash.toLowerCase())} /></Field><Field label="Keberatan / hash"><DocumentHash hash={claim.objectionHash} doc={docs.map.get(claim.objectionHash.toLowerCase())} /></Field><Field label="Objector"><AddressChip address={claim.objector} /></Field></dl>
      {docs.error && <p className="text-xs text-rose-700">Dokumen privat tidak dapat dibaca: {(docs.error as Error).message}</p>}
      {claim.decidedAt > 0 && <dl className="grid gap-4 rounded-md bg-slate-50 p-4 sm:grid-cols-2"><Field label="Keputusan dicatat">{formatDateTime(claim.decidedAt)}</Field><Field label="Jenis default terverifikasi">{defaultTypeLabel[claim.verifiedType]}</Field><Field label="Terkirim terverifikasi">{formatQty(claim.verifiedDeliveredQuantity, right.unit)}</Field><Field label="Kerugian disetujui">{formatToken(claim.approvedLoss)}</Field><Field label="Payout ditetapkan kontrak">{formatToken(claim.payoutAmount)}</Field><Field label="Bagian coverage">{formatBps(position.coverageBps)}</Field></dl>}
      {claim.status === ClaimStatus.Settled && <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm"><p className="font-medium text-teal-900">Settlement tercatat {formatDateTime(claim.settledAt)}</p><p className="mt-1">Kompensasi {formatToken(claim.payoutAmount)}; <Link className="text-teal-700 underline" href={`/verify?type=recovery&id=${claim.recoveryTokenId}`}>Recovery Claim NFT #{claim.recoveryTokenId}</Link> untuk provider.</p></div>}
      <Button asChild size="sm" variant="outline"><Link href={`/verify?type=protection&id=${position.id}`}>Verifikasi publik proteksi</Link></Button>
    </CardContent></Card>

    {[ClaimStatus.Submitted, ClaimStatus.Disputed].includes(claim.status) && <Card><CardHeader><CardTitle>Keputusan independen</CardTitle><CardDescription>Verifikator menentukan kuantitas aktual dan kerugian eligible. Tenggat lewat tidak menyetujui klaim otomatis.</CardDescription></CardHeader><CardContent className="space-y-4">
      {!canDecide ? <p className="text-sm text-muted-foreground">{!address ? "Hubungkan wallet verifikator." : !roles.data?.verifier ? "Wallet memerlukan VERIFIER_ROLE." : "Verifikator harus berbeda dari pemohon, buyer, dan provider."}</p> : <>
        <div><Label htmlFor="verified-qty">Kuantitas terkirim terverifikasi ({right.unit})</Label><Input id="verified-qty" className="mt-2" inputMode="decimal" value={verifiedText} onChange={(e) => setVerifiedText(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Jenis default terverifikasi: {verified === 0n ? "penuh" : "sebagian"}; tipe ditentukan kontrak dari kuantitas.</p></div>
        <div><Label htmlFor="approved-loss">Kerugian eligible (mETH)</Label><Input id="approved-loss" className="mt-2" inputMode="decimal" value={approvedText} onChange={(e) => setApprovedText(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Batas: {formatToken(cap)} · Quote kontrak: {quote.isFetching ? "membaca…" : formatToken(quote.data)}</p></div>
        {unlocked ? <PrivateReport kind="VERIFIER_REPORT" chainId={chainId} claimId={claim.id} document={report} setDocument={setReport} disabled={tx.busy} /> : <p className="text-xs text-muted-foreground">Buka data privat untuk menyimpan laporan.</p>}
        {approvalError && <p className="text-xs text-muted-foreground">{approvalError}</p>}
        {quote.error && <p className="text-xs text-rose-700">Quote gagal: {(quote.error as Error).message}</p>}
        <Button disabled={disabled || !!approvalError || !!quote.error} onClick={() => verified !== null && approved !== null && report && act("approveClaim", [BigInt(claim.id), verified, approved, report.sha256], "Setujui klaim")}>Setujui setelah verifikasi</Button>
        <div className="space-y-3 border-t pt-4"><SectionTitle>Tolak klaim</SectionTitle><Label htmlFor="reject-reason">Ringkasan alasan publik (maks. 512 byte)</Label><Textarea id="reject-reason" value={publicReason} onChange={(e) => setPublicReason(e.target.value)} placeholder="Ringkasan yang aman ditampilkan publik; detail sensitif ada di laporan privat." />{unlocked && <PrivateReport kind="REJECTION_REPORT" chainId={chainId} claimId={claim.id} document={rejectReport} setDocument={setRejectReport} disabled={tx.busy} />}<Button variant="destructive" disabled={disabled || !rejectReport || !publicReason.trim() || new TextEncoder().encode(publicReason.trim()).length > 512} onClick={() => rejectReport && act("rejectClaim", [BigInt(claim.id), rejectReport.sha256, publicReason.trim()], "Tolak klaim")}>Tolak dengan laporan</Button></div>
      </>}
    </CardContent></Card>}

    {claim.status === ClaimStatus.Approved && <Card><CardHeader><CardTitle>Settlement atomik</CardTitle><CardDescription>Siapa pun dapat memicu settlement. Beneficiary, provider, payout, dan NFT ditentukan data kontrak.</CardDescription></CardHeader><CardContent className="space-y-4"><dl className="grid gap-4 sm:grid-cols-2"><Field label="Payout yang akan dikirim">{formatToken(claim.payoutAmount)}</Field><Field label="Sisa collateral terkunci">{formatToken(position.lockedAmount)}</Field><Field label="Settlement paling awal">{formatDateTime(readyAt)}</Field><Field label="Waktu blok terakhir">{formatDateTime(now)}</Field></dl>{!canSettle && <p className="text-sm text-amber-800">{now < readyAt ? "Menunggu masa minimum keberatan sebelum settlement." : "Settlement belum eligible menurut status, sisa kerugian, atau collateral kontrak."}</p>}<p className="text-xs text-muted-foreground">Keberatan masih dapat diajukan sampai transaksi settlement berhasil. Sengketa harus diputuskan ulang sebelum dana dapat dikirim.</p><Button disabled={disabled || !canSettle} onClick={() => act("settleClaim", [BigInt(claim.id)], "Settlement klaim")}>Kirim kompensasi & cetak Recovery NFT</Button></CardContent></Card>}

    {(canObject || canWithdraw || (claim.status === ClaimStatus.Rejected && claimant)) && <Card><CardHeader><CardTitle>Keberatan, banding & penarikan</CardTitle></CardHeader><CardContent className="space-y-4">
      {claim.status === ClaimStatus.Rejected && <p className="text-sm text-muted-foreground">Batas banding yang tercatat: {guard.isFetching ? "membaca…" : formatDateTime(guard.data?.appealDeadline)}. {canAppeal ? "Klaim ini masih dapat diajukan banding satu kali." : "Banding tidak tersedia: periksa deadline, klaim terbaru, dan status Supply Right."}</p>}
      {canObject && <>{unlocked ? <PrivateReport kind="OBJECTION" chainId={chainId} claimId={claim.id} document={objection} setDocument={setObjection} disabled={tx.busy} /> : <p className="text-xs text-muted-foreground">Buka data privat untuk menyimpan laporan keberatan.</p>}<Button variant="outline" disabled={disabled || !objection || !!guard.error} onClick={() => objection && act("raiseObjection", [BigInt(claim.id), objection.sha256], canAppeal ? "Ajukan banding" : "Ajukan keberatan")}>{canAppeal ? "Ajukan banding" : "Ajukan keberatan"}</Button></>}
      {canWithdraw && <div className="border-t pt-3"><p className="mb-2 text-xs text-muted-foreground">Penarikan menutup klaim tanpa payout dan membuka kembali status sesuai riwayat settlement.</p><Button variant="outline" disabled={disabled} onClick={() => act("withdrawClaim", [BigInt(claim.id)], "Tarik klaim")}>Tarik klaim saya</Button></div>}
      {guard.error && <p className="text-xs text-rose-700">Pemeriksaan banding gagal: {(guard.error as Error).message}</p>}
    </CardContent></Card>}

    <TxStatus state={tx.state} />
    {confirmedSettlement && <Card className="border-teal-200 bg-teal-50"><CardHeader><CardTitle>Settlement terkonfirmasi</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><Field label="Transaksi"><TxLink hash={confirmedSettlement.hash} /></Field><Field label="Payout aktual">{formatToken(confirmedSettlement.payout)}</Field><Field label="Beneficiary"><AddressChip address={confirmedSettlement.beneficiary} /></Field><Field label="Provider penerima NFT"><AddressChip address={confirmedSettlement.provider} /></Field><Field label="Recovery NFT"><Link className="text-teal-700 underline" href={`/verify?type=recovery&id=${confirmedSettlement.recoveryId}`}>#{confirmedSettlement.recoveryId.toString()}</Link></Field><Field label="Settlement reference"><HashChip hash={confirmedSettlement.reference} /></Field></dl></CardContent></Card>}
    <Card><CardHeader><CardTitle>Jejak onchain SR #{right.id}</CardTitle></CardHeader><CardContent><AuditTimeline supplyRightId={right.id} /></CardContent></Card>
  </div>;
}

function PrivateReport({ kind, chainId, claimId, document, setDocument, disabled }: { kind: DocumentKind; chainId: number; claimId: number; document: StoredDocument | null; setDocument: (doc: StoredDocument) => void; disabled: boolean }) {
  const [content, setContent] = useState("");
  const create = useCreateTextDocument();
  async function save() {
    try {
      const doc = await create.mutateAsync({ kind, title: `${kind} · klaim #${claimId}`, content: content.trim(), contextKey: contextKey("claim", chainId, claimId) });
      setDocument(doc);
      toast.success("Laporan tersimpan privat");
    } catch (error) { toast.error("Gagal menyimpan laporan", { description: (error as Error).message }); }
  }
  return <div className="space-y-3"><DocumentUpload kind={kind} contextKey={contextKey("claim", chainId, claimId)} value={document} onUploaded={setDocument} disabled={disabled || create.isPending} /><details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer text-teal-700">Atau tulis laporan privat</summary><Textarea className="mt-3" aria-label={`Isi laporan ${kind}`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Temuan, bukti pendukung, dan pertimbangan keputusan." /><Button className="mt-2" size="sm" variant="outline" onClick={save} disabled={disabled || create.isPending || !content.trim()}>Simpan laporan & hash</Button></details></div>;
}

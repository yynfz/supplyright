"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BaseError, ContractFunctionRevertedError, maxUint256, type Hex } from "viem";
import { AlertTriangle, ArrowRight, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { claimManagerAbi, protectionNftAbi, recoveryClaimNftAbi, supplyRightNftAbi, vaultAbi } from "@/generated/abis";
import { AuditTimeline } from "@/components/audit-timeline";
import { AddressChip, HashChip, NftLink, TxLink } from "@/components/onchain";
import { EmptyState, Field, KpiCard, PageHeader, SectionTitle } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useChainRead } from "@/hooks/claims-chain-read";
import { useActiveChain, useProtocolSnapshot } from "@/hooks/use-protocol";
import { formatBps, formatDateTime, formatQty, formatToken } from "@/lib/format";
import { decodeProtocolLog } from "@/lib/protocol/events";
import { describeEvent } from "@/lib/protocol/describe";
import { claimStatusLabel, protectionClaimStatusLabel, protectionStatusLabel, recoveryStatusLabel, supplyStatusLabel } from "@/lib/protocol/labels";
import { ClaimStatus, type ProtectionClaimStatus, type ProtectionStatus, type RecoveryStatus, type SupplyStatus } from "@/lib/protocol/types";

type LookupType = "supply" | "protection" | "recovery";
const NAME = { supply: "Supply Right NFT", protection: "Protection NFT", recovery: "Recovery Claim NFT" };
const SELECT = "h-9 w-full rounded-md border bg-white px-3 text-sm";

function parseId(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try { const id = BigInt(value); return id > 0n && id <= maxUint256 ? id : null; } catch { return null; }
}

function unitText(hex: string) {
  const bytes = hex.replace(/^0x/, "").match(/.{2}/g) ?? [];
  return bytes.map((byte) => String.fromCharCode(parseInt(byte, 16))).join("").replace(/\0.*$/, "");
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 text-navy">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="SupplyRight — beranda">
            <span className="flex size-9 items-center justify-center rounded-lg bg-navy text-teal-300">
              <ShieldCheck className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              SupplyRight<span className="text-teal-600">.</span>
            </span>
          </Link>
          <nav aria-label="Navigasi utama" className="flex items-center gap-5 text-sm">
            <Link href="/" className="text-slate-600 transition hover:text-navy">
              Beranda
            </Link>
            <span className="font-semibold text-teal-700">Verifikasi Publik</span>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-navy px-4 py-2 font-medium text-white transition hover:bg-navy-soft"
            >
              <span className="hidden sm:inline">Buka platform</span>
              <span className="sm:hidden">Buka app</span>
              <ArrowRight className="size-4" />
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <VerifyRoute />
        </Suspense>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">SupplyRight<span className="text-teal-600">.</span></p>
            <p className="text-[11px] text-slate-500">Prototipe hackathon · testnet · belum diaudit</p>
          </div>
          <p className="mt-4 max-w-5xl text-xs leading-relaxed text-slate-500">
            NFT mencatat representasi digital hak pasokan dan recovery. Keberlakuan hukum, hak penagihan, dan kewajiban para pihak bergantung pada perjanjian bertanda tangan serta ketentuan yang berlaku. Prototipe ini belum diaudit dan bukan produk asuransi atau jaminan pengembalian dana.
          </p>
        </div>
      </footer>
    </div>
  );
}

function VerifyRoute() {
  const params = useSearchParams();
  return <VerifyContent key={params.toString()} />;
}

/** This page only reads deployment config and public RPC; it never calls private document APIs. */
function VerifyContent() {
  const params = useSearchParams();
  const router = useRouter();
  const active = useActiveChain();
  const snapshot = useProtocolSnapshot();
  const typeParam = params.get("type");
  const type: LookupType = typeParam === "protection" || typeParam === "recovery" ? typeParam : "supply";
  const id = parseId(params.get("id"));
  const txParam = params.get("tx") ?? params.get("txHash");
  const txHash = txParam && /^0x[0-9a-fA-F]{64}$/.test(txParam) ? txParam as Hex : null;
  const [formType, setFormType] = useState<LookupType>(type);
  const [idText, setIdText] = useState(params.get("id") ?? "");
  const [txText, setTxText] = useState(txParam ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanId = idText.trim();
    const cleanTx = txText.trim();
    if (cleanId && !parseId(cleanId)) return setInputError("Gunakan ID integer positif dalam rentang uint256.");
    if (cleanTx && !/^0x[0-9a-fA-F]{64}$/.test(cleanTx)) return setInputError("Hash transaksi harus 0x diikuti 64 karakter heksadesimal.");
    if (!cleanId && !cleanTx) return setInputError("Isi ID NFT atau hash transaksi.");
    setInputError(null);
    const query = new URLSearchParams();
    if (cleanId) { query.set("type", formType); query.set("id", cleanId); }
    if (cleanTx) query.set("tx", cleanTx);
    router.push(`/verify?${query}`);
  }
  const snap = snapshot.data;
  const accounted = (snap?.vault.totalFree ?? 0n) + (snap?.vault.totalLocked ?? 0n);
  return <>
    <PageHeader eyebrow="Bukti publik onchain" title="Public Rights Verification" description="Periksa kepemilikan, hash bukti, status proteksi, dan settlement langsung dari jaringan. Tidak perlu wallet atau akses dokumen privat." />
    <Card className="mb-6"><CardHeader><CardTitle>Cari NFT atau transaksi</CardTitle><CardDescription>ID hanya berlaku pada jaringan aktif · chain {active.chainId}.</CardDescription></CardHeader><CardContent><form onSubmit={search} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]"><div><Label htmlFor="verify-type">Jenis catatan</Label><select id="verify-type" className={`${SELECT} mt-2`} value={formType} onChange={(e) => setFormType(e.target.value as LookupType)}>{Object.entries(NAME).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div><div><Label htmlFor="verify-id">ID NFT</Label><Input id="verify-id" className="mt-2" inputMode="numeric" value={idText} onChange={(e) => setIdText(e.target.value)} placeholder="1" /></div><div><Label htmlFor="verify-tx">Hash transaksi (opsional)</Label><Input id="verify-tx" className="mt-2 font-mono text-xs" value={txText} onChange={(e) => setTxText(e.target.value)} placeholder="0x…" /></div></div>{inputError && <p role="alert" className="text-sm text-rose-700">{inputError}</p>}<Button type="submit"><Search className="size-4" />Verifikasi publik</Button></form></CardContent></Card>
    {active.configLoading ? <Skeleton className="h-40" /> : !active.deployment ? <EmptyState title="Deployment tidak tersedia" description="Kontrak SupplyRight belum dikonfigurasi pada jaringan aktif ini." /> : <>
      {params.has("id") && !id && <EmptyState icon={AlertTriangle} title="ID tidak valid" description="ID NFT harus berupa integer positif dalam rentang uint256." />}
      {txParam && !txHash && <EmptyState icon={AlertTriangle} title="Hash transaksi tidak valid" description="Hash harus berisi 32 byte heksadesimal dengan awalan 0x." />}
      {txHash && <div className="mb-6"><ReceiptVerification key={txHash} hash={txHash} /></div>}
      {id && <div className="mb-6"><EntityVerification key={`${type}:${id}`} type={type} id={id} transactionHash={txHash} /></div>}
      {!id && !txParam && <div className="mb-6"><EmptyState icon={ShieldCheck} title="Masukkan ID atau hash untuk mulai" description="Hasil berasal dari deployment SupplyRight pada jaringan aktif. Hash dokumen mengikat data onchain dengan dokumen yang dimiliki para pihak." /></div>}
      <Card><CardHeader><CardTitle>Akuntansi vault publik</CardTitle><CardDescription>Collateral bebas + terkunci dibandingkan saldo ETH native kontrak vault. Dana payout historis tidak dihitung sebagai saldo tersedia.</CardDescription></CardHeader><CardContent>{snapshot.isLoading ? <Skeleton className="h-28" /> : snapshot.error ? <p className="text-sm text-rose-700">Gagal membaca vault: {(snapshot.error as Error).message}</p> : snap ? <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><KpiCard label="Collateral bebas" value={formatToken(snap.vault.totalFree)} /><KpiCard label="Collateral terkunci" value={formatToken(snap.vault.totalLocked)} tone="teal" /><KpiCard label="Payout historis" value={formatToken(snap.vault.totalPaidOut)} tone="success" /><KpiCard label="Saldo ETH vault (escrow)" value={formatToken(snap.vault.ethBalance)} /></div><div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><StatusBadge label={snap.vault.ethBalance >= accounted ? "Saldo ETH mencukupi collateral tercatat" : "Saldo ETH kurang dari collateral tercatat"} tone={snap.vault.ethBalance >= accounted ? "success" : "danger"} /><span className="text-xs text-muted-foreground">Blok {snap.blockNumber.toString()} · {formatDateTime(snap.blockTimestamp)}</span></div><dl className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Alamat vault"><AddressChip address={active.deployment.vault} /></Field><Field label="Aset settlement">ETH native (tanpa token ERC-20)</Field></dl></> : <p className="text-sm text-muted-foreground">Menunggu RPC.</p>}</CardContent></Card>
      <p className="mt-4 text-xs text-muted-foreground">NFT adalah catatan digital dan rujukan hash. Keberlakuan hak atas pasokan, pengalihan, dan recovery bergantung pada perjanjian yang sah di antara para pihak. Prototipe testnet.</p>
    </>}
  </>;
}

function ReceiptVerification({ hash }: { hash: Hex }) {
  const receiptQuery = useChainRead(["verify-receipt", hash], async (client, deployment) => {
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash }); }
    catch (error) {
      if ((error as Error).name === "TransactionReceiptNotFoundError") return null;
      throw error;
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const events = receipt.logs.map((log) => decodeProtocolLog(deployment, log, Number(block.timestamp))).filter((event) => event !== null);
    return { receipt, timestamp: Number(block.timestamp), events };
  });
  const result = receiptQuery.data;
  return <Card><CardHeader><CardTitle>Receipt transaksi</CardTitle><CardDescription><TxLink hash={hash} /></CardDescription></CardHeader><CardContent className="space-y-4">
    {receiptQuery.isLoading ? <Skeleton className="h-28" /> : receiptQuery.error ? <EmptyState icon={AlertTriangle} title="RPC tidak dapat membaca receipt" description={(receiptQuery.error as Error).message} /> : result === null ? <EmptyState title="Receipt belum ditemukan" description="Transaksi mungkin belum ditambang atau berada pada jaringan lain. Belum ada hasil terkonfirmasi." /> : result ? <>
      <div className="flex flex-wrap items-center gap-3"><StatusBadge label={result.receipt.status === "reverted" ? "Transaksi reverted" : result.events.length ? "Event kontrak SupplyRight ditemukan" : "Transaksi berhasil · tanpa event SupplyRight"} tone={result.receipt.status === "reverted" ? "danger" : result.events.length ? "success" : "neutral"} /><span className="text-xs text-muted-foreground">Blok {result.receipt.blockNumber.toString()} · {formatDateTime(result.timestamp)}</span></div>
      <dl className="grid gap-4 sm:grid-cols-2"><Field label="Pengirim"><AddressChip address={result.receipt.from} /></Field><Field label="Tujuan transaksi"><AddressChip address={result.receipt.to} /></Field><Field label="Gas terpakai">{result.receipt.gasUsed.toString()}</Field><Field label="Hash blok"><HashChip hash={result.receipt.blockHash} /></Field></dl>
      {result.receipt.status === "reverted" ? <p className="text-sm text-rose-700">Transaksi gagal. Tidak ada hasil protokol yang boleh dianggap telah berlaku dari receipt ini.</p> : result.events.length === 0 ? <p className="text-sm text-muted-foreground">Receipt ini tidak membuktikan penerbitan NFT atau settlement SupplyRight karena tidak ada event dari alamat kontrak deployment aktif.</p> : <ol className="space-y-3 rounded-md border bg-slate-50 p-4">{result.events.map((event) => {
        const description = describeEvent(event);
        const sr = event.args.supplyRightId ?? (event.contract === "supplyRightNFT" ? event.args.tokenId : undefined);
        const recovery = event.args.recoveryTokenId ?? (event.contract === "recoveryClaimNFT" ? event.args.tokenId : undefined);
        const protection = event.args.protectionId ?? (event.contract === "protectionNFT" ? event.args.tokenId : undefined);
        return <li key={event.id}><p className="text-sm font-medium text-navy">{description.title}</p>{description.detail && <p className="text-xs text-muted-foreground">{description.detail}</p>}<p className="mt-1 flex flex-wrap gap-3 text-xs"><span className="text-muted-foreground">{event.contract} · log {event.logIndex}</span>{sr !== undefined && <Link className="text-teal-700 underline" href={`/verify?type=supply&id=${String(sr)}`}>Supply Right #{String(sr)}</Link>}{protection !== undefined && <Link className="text-teal-700 underline" href={`/verify?type=protection&id=${String(protection)}`}>Proteksi #{String(protection)}</Link>}{recovery !== undefined && <Link className="text-teal-700 underline" href={`/verify?type=recovery&id=${String(recovery)}`}>Recovery #{String(recovery)}</Link>}</p></li>;
      })}</ol>}
    </> : <p className="text-sm text-muted-foreground">Menunggu pembacaan receipt.</p>}
  </CardContent></Card>;
}

function EntityVerification({ type, id, transactionHash }: { type: LookupType; id: bigint; transactionHash: Hex | null }) {
  const { deployment } = useActiveChain();
  const query = useChainRead(["verify-entity", type, id.toString(), transactionHash], async (client, d) => {
    const block = await client.getBlock();
    const blockNumber = block.number;
    const contract = type === "supply" ? d.supplyRightNFT : type === "protection" ? d.protectionNFT : d.recoveryClaimNFT;
    const abi = type === "supply" ? supplyRightNftAbi : type === "protection" ? protectionNftAbi : recoveryClaimNftAbi;
    let owner;
    try { owner = await client.readContract({ address: contract, abi: abi as typeof supplyRightNftAbi, functionName: "ownerOf", args: [id], blockNumber }); }
    catch (error) {
      if (error instanceof BaseError && error.walk((nested) => nested instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return null;
      throw error;
    }
    const supply = type === "supply" ? await client.readContract({ address: d.supplyRightNFT, abi: supplyRightNftAbi, functionName: "getSupplyRight", args: [id], blockNumber }) : null;
    const protection = type === "protection" ? await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getProtection", args: [id], blockNumber }) : null;
    const terms = type === "protection" ? await client.readContract({ address: d.protectionNFT, abi: protectionNftAbi, functionName: "getTerms", args: [id], blockNumber }) : null;
    const recovery = type === "recovery" ? await client.readContract({ address: d.recoveryClaimNFT, abi: recoveryClaimNftAbi, functionName: "getRecoveryClaim", args: [id], blockNumber }) : null;
    const supplyId = supply ? id : protection?.supplyRightId ?? recovery!.supplyRightId;
    const linkedSupply = supply ?? await client.readContract({ address: d.supplyRightNFT, abi: supplyRightNftAbi, functionName: "getSupplyRight", args: [supplyId], blockNumber });
    const protectionId = protection ? id : recovery?.protectionId ?? linkedSupply.protectionId;
    const linkedProtection = protection ?? (protectionId > 0n ? await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getProtection", args: [protectionId], blockNumber }) : null);
    const claimIds = await client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "claimsOfSupplyRight", args: [supplyId], blockNumber });
    const claims = await Promise.all(claimIds.map(async (claimId) => ({ id: claimId, ...await client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "getClaim", args: [claimId], blockNumber }) })));
    let relatedTransaction: boolean | null = null;
    if (transactionHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: transactionHash });
        if (receipt.status === "success") {
          relatedTransaction = receipt.logs.some((log) => {
            const event = decodeProtocolLog(d, log);
            if (!event) return false;
            const args = event.args;
            if (args.supplyRightId === supplyId) return true;
            if (event.contract === "supplyRightNFT" && args.tokenId === supplyId) return true;
            if (protectionId > 0n && (args.protectionId === protectionId || (event.contract === "protectionNFT" && args.tokenId === protectionId))) return true;
            if (type === "recovery" && (args.recoveryTokenId === id || (event.contract === "recoveryClaimNFT" && args.tokenId === id))) return true;
            return claims.some((claim) => args.claimId === claim.id);
          });
        } else relatedTransaction = false;
      } catch (error) {
        if ((error as Error).name !== "TransactionReceiptNotFoundError") throw error;
      }
    }
    return { owner, contract, blockNumber, timestamp: Number(block.timestamp), supply, protection, terms, recovery, supplyId, linkedSupply, protectionId, linkedProtection, claims, relatedTransaction };
  });
  const data = query.data;
  return <Card><CardHeader><CardTitle>{NAME[type]} #{id.toString()}</CardTitle><CardDescription>Data dan pemilik dibaca langsung dari kontrak NFT pada blok yang sama.</CardDescription></CardHeader><CardContent className="space-y-6">
    {query.isLoading ? <Skeleton className="h-48" /> : query.error ? <EmptyState icon={AlertTriangle} title="Data kontrak tidak dapat dibaca" description={(query.error as Error).message} /> : data === null ? <EmptyState title="NFT tidak ditemukan" description="ID ini tidak tercatat pada kontrak NFT jaringan aktif." /> : data && deployment ? <>
      <div className="flex flex-wrap items-center gap-3"><StatusBadge label="NFT tercatat onchain" tone="success" /><span className="text-xs text-muted-foreground">Blok {data.blockNumber.toString()} · {formatDateTime(data.timestamp)}</span></div>
      <dl className="grid gap-4 sm:grid-cols-2"><Field label="Pemilik NFT saat ini"><AddressChip address={data.owner} /></Field><Field label="Alamat kontrak NFT"><AddressChip address={data.contract} /></Field><Field label="Supply Right terkait"><Link className="text-teal-700 underline" href={`/verify?type=supply&id=${data.supplyId}`}>SR #{data.supplyId.toString()}</Link></Field><Field label="Status pasokan"><StatusBadge {...supplyStatusLabel[Number(data.linkedSupply.status) as SupplyStatus]} /></Field><Field label="Buyer pada catatan"><AddressChip address={data.linkedSupply.buyer} /></Field><Field label="Tenggat pengiriman">{formatDateTime(Number(data.linkedSupply.deliveryDeadline))}</Field><Field label="Dipesan / terkirim">{formatQty(data.linkedSupply.orderedQuantity, unitText(data.linkedSupply.unit))} / {formatQty(data.linkedSupply.deliveredQuantity, unitText(data.linkedSupply.unit))}</Field><Field label="Aset settlement">ETH native · escrow di <AddressChip address={deployment.vault} /></Field></dl>
      <div><SectionTitle>Rujukan dokumen publik</SectionTitle><dl className="grid gap-4 sm:grid-cols-2"><Field label="PO reference hash"><HashChip hash={data.linkedSupply.poRefHash} /></Field><Field label="Agreement hash"><HashChip hash={data.linkedSupply.agreementHash} /></Field><Field label="Supplier reference hash"><HashChip hash={data.linkedSupply.supplierRefHash} /></Field><Field label="Supplier acknowledgment hash"><HashChip hash={data.linkedSupply.supplierAckHash} /></Field></dl></div>
      {data.linkedProtection && <div className="rounded-md border bg-slate-50 p-4"><SectionTitle>Proteksi #{data.protectionId.toString()}</SectionTitle><dl className="grid gap-4 sm:grid-cols-2"><Field label="Status proteksi"><StatusBadge {...protectionStatusLabel[Number(data.linkedProtection.status) as ProtectionStatus]} /></Field>{data.terms && <Field label="Status klaim pada NFT"><StatusBadge {...protectionClaimStatusLabel[Number(data.terms.claimStatus) as ProtectionClaimStatus]} /></Field>}<Field label="Provider"><AddressChip address={data.linkedProtection.provider} /></Field><Field label="Beneficiary"><AddressChip address={data.linkedProtection.beneficiary} /></Field><Field label="Coverage maksimal">{formatToken(data.linkedProtection.coverageAmount)}</Field><Field label="Bagian kerugian yang dilindungi">{formatBps(Number(data.linkedProtection.coverageBps))}</Field><Field label="Collateral terkunci">{formatToken(data.linkedProtection.lockedAmount)}</Field><Field label="Dibayar / dilepas">{formatToken(data.linkedProtection.paidAmount)} / {formatToken(data.linkedProtection.releasedAmount)}</Field><Field label="Periode proteksi">{formatDateTime(Number(data.linkedProtection.startsAt))} — {formatDateTime(Number(data.linkedProtection.expiresAt))}</Field><Field label="Terms hash"><HashChip hash={data.linkedProtection.termsHash} /></Field></dl><Link className="mt-4 inline-block text-xs text-teal-700 underline" href={`/verify?type=protection&id=${data.protectionId}`}>Buka kepemilikan Protection NFT</Link></div>}
      {data.recovery && <div className="rounded-md border border-teal-200 bg-teal-50 p-4"><SectionTitle>Recovery & settlement</SectionTitle><dl className="grid gap-4 sm:grid-cols-2"><Field label="Status recovery"><StatusBadge {...recoveryStatusLabel[Number(data.recovery.status) as RecoveryStatus]} /></Field><Field label="Provider awal"><AddressChip address={data.recovery.provider} /></Field><Field label="Kompensasi tercatat">{formatToken(data.recovery.compensationAmount)}</Field><Field label="Recovery / telah pulih">{formatToken(data.recovery.recoveryAmount)} / {formatToken(data.recovery.recoveredAmount)}</Field><Field label="Settled at / block">{formatDateTime(Number(data.recovery.settledAt))} · blok {data.recovery.settledBlock.toString()}</Field><Field label="Settlement reference"><HashChip hash={data.recovery.settlementRef} /></Field><Field label="Evidence hash"><HashChip hash={data.recovery.evidenceHash} /></Field><Field label="Decision hash"><HashChip hash={data.recovery.decisionHash} /></Field><Field label="Update hash"><HashChip hash={data.recovery.lastUpdateHash} /></Field></dl></div>}
      {transactionHash && <p className={`rounded-md border p-3 text-sm ${data.relatedTransaction ? "border-teal-200 bg-teal-50 text-teal-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{data.relatedTransaction === null ? "Receipt transaksi belum tersedia; hubungan ke catatan ini belum dapat dikonfirmasi." : data.relatedTransaction ? "Receipt berhasil memiliki event protokol yang terkait dengan rangkaian Supply Right ini." : "Transaksi tidak menunjukkan event berhasil yang terkait dengan rangkaian Supply Right ini."}</p>}
      <div><SectionTitle>Klaim terkait</SectionTitle>{data.claims.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada klaim.</p> : <div className="space-y-3">{data.claims.map((claim) => {
        const status = Number(claim.status) as ClaimStatus;
        const settled = status === ClaimStatus.Settled;
        const approved = status === ClaimStatus.Approved;
        return <div key={claim.id.toString()} className="rounded-md border p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Link href={`/claims?claim=${claim.id}&supply=${data.supplyId}`} className="text-sm font-medium text-teal-700 underline">Klaim #{claim.id.toString()}</Link><StatusBadge {...claimStatusLabel[status]} /></div><dl className="grid gap-4 sm:grid-cols-2"><Field label="Pemohon"><AddressChip address={claim.claimant} /></Field><Field label="Verifikator"><AddressChip address={claim.verifier} /></Field><Field label="Kerugian disetujui">{formatToken(claim.approvedLoss)}</Field><Field label={settled ? "Kompensasi dibayar" : approved ? "Payout disetujui (belum dibayar)" : "Payout belum dibayar"}>{settled || approved ? formatToken(claim.payoutAmount) : "—"}</Field><Field label="Evidence hash"><HashChip hash={claim.evidenceHash} /></Field><Field label="Decision hash"><HashChip hash={claim.decisionHash} /></Field><Field label="Objection hash"><HashChip hash={claim.objectionHash} /></Field>{claim.recoveryTokenId > 0n && <Field label="Recovery NFT"><Link className="text-teal-700 underline" href={`/verify?type=recovery&id=${claim.recoveryTokenId}`}>#{claim.recoveryTokenId.toString()}</Link></Field>}</dl></div>;
      })}</div>}</div>
      {id <= BigInt(Number.MAX_SAFE_INTEGER) && <NftLink contract={data.contract} tokenId={Number(id)}><span className="inline-flex items-center gap-1 text-xs text-teal-700"><CheckCircle2 className="size-3.5" />Lihat NFT pada explorer</span></NftLink>}
      {data.supplyId <= BigInt(Number.MAX_SAFE_INTEGER) && <div><SectionTitle>Jejak aktivitas onchain</SectionTitle><AuditTimeline supplyRightId={Number(data.supplyId)} /></div>}
    </> : <p className="text-sm text-muted-foreground">Menunggu pembacaan kontrak.</p>}
  </CardContent></Card>;
}

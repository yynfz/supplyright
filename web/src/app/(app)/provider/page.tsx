"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { AlertTriangle, Coins, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import { claimManagerAbi, mockEthAbi, recoveryClaimNftAbi, vaultAbi } from "@/generated/abis";
import { useActiveChain, useBalances, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { useCreateTextDocument, useDocumentIndex } from "@/hooks/use-offchain";
import { AuditTimeline } from "@/components/audit-timeline";
import { AddressChip } from "@/components/onchain";
import { EmptyState, Field, KpiCard, PageHeader } from "@/components/page";
import { DocumentHash, DocumentUpload, PrivateDataNotice, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { TxStatus } from "@/components/tx-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatToken } from "@/lib/format";
import { contextKey, type StoredDocument } from "@/lib/offchain-types";
import { claimStatusLabel, protectionStatusLabel, recoveryStatusLabel } from "@/lib/protocol/labels";
import { ProtectionStatus, RecoveryStatus, RequestStatus, SupplyStatus, type RecoveryClaim } from "@/lib/protocol/types";
import { ensureVaultAllowance, exactAmount, ProtectionRequests, sameAccount, selectClass, usePageTransactions, type PageTransactions } from "../protection/_components/protection-actions";

function RecoveryEditor({ recovery, unlocked, actions }: { recovery: RecoveryClaim; unlocked: boolean; actions: PageTransactions }) {
  const { address } = useAccount();
  const { deployment, chainId, wrongNetwork } = useActiveChain();
  const memo = useCreateTextDocument();
  const [status, setStatus] = useState(String(RecoveryStatus.InRecovery));
  const [recovered, setRecovered] = useState(formatUnits(recovery.recoveredAmount, 18));
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<StoredDocument | null>(null);
  useEffect(() => {
    setStatus(String(RecoveryStatus.InRecovery));
    setRecovered(formatUnits(recovery.recoveredAmount, 18));
    setNotes("");
    setEvidence(null);
  }, [chainId, address, recovery.id, recovery.recoveredAmount]);
  const terminal = recovery.status === RecoveryStatus.Recovered || recovery.status === RecoveryStatus.WrittenOff;
  const update = () => actions.run(async () => {
    if (!deployment || !sameAccount(recovery.owner, address) || wrongNetwork) throw new Error("Hanya pemegang Recovery NFT yang dapat memperbarui progres.");
    if (!unlocked || (!notes.trim() && !evidence)) throw new Error("Buka data privat dan isi catatan atau unggah bukti pemulihan.");
    const amount = exactAmount(recovered);
    const newStatus = Number(status);
    if (![RecoveryStatus.InRecovery, RecoveryStatus.PartiallyRecovered, RecoveryStatus.Recovered, RecoveryStatus.WrittenOff].includes(newStatus)) throw new Error("Status pemulihan tidak valid.");
    if (amount < recovery.recoveredAmount || amount > recovery.recoveryAmount) throw new Error("Jumlah kumulatif tidak boleh turun atau melampaui target pemulihan.");
    if (newStatus === RecoveryStatus.Recovered && amount !== recovery.recoveryAmount) throw new Error("Status pulih penuh memerlukan jumlah sama dengan target pemulihan.");
    if (newStatus === RecoveryStatus.PartiallyRecovered && (amount === 0n || amount === recovery.recoveryAmount)) throw new Error("Pemulihan sebagian harus di atas nol dan di bawah target pemulihan.");
    const document = evidence ?? await memo.mutateAsync({ kind: "RECOVERY_UPDATE", title: `Update Recovery #${recovery.id}`, content: notes.trim(), contextKey: contextKey("recovery", chainId, recovery.id) });
    const receipt = await actions.tx.send({ label: `Catat progres Recovery #${recovery.id}`, address: deployment.recoveryClaimNFT, abi: recoveryClaimNftAbi, functionName: "updateRecovery", args: [BigInt(recovery.id), newStatus, amount, document.sha256] });
    if (receipt) { setNotes(""); setEvidence(null); }
  });
  if (terminal || !sameAccount(recovery.owner, address)) return null;
  return <form className="space-y-3 rounded-lg bg-slate-50 p-3" onSubmit={e => { e.preventDefault(); update(); }}>
    <p className="text-xs text-muted-foreground">Progres dilaporkan pemegang NFT. Pencatatan ini tidak memindahkan token atau membuktikan pembayaran pemasok.</p>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor={`recovery-status-${recovery.id}`}>Status baru</Label><select id={`recovery-status-${recovery.id}`} className={selectClass} value={status} onChange={e => setStatus(e.target.value)} disabled={actions.busy || !unlocked}>{[RecoveryStatus.InRecovery, RecoveryStatus.PartiallyRecovered, RecoveryStatus.Recovered, RecoveryStatus.WrittenOff].map(s => <option key={s} value={s}>{recoveryStatusLabel[s].label}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor={`recovery-amount-${recovery.id}`}>Total pulih kumulatif (mETH)</Label><Input id={`recovery-amount-${recovery.id}`} inputMode="decimal" value={recovered} onChange={e => setRecovered(e.target.value)} disabled={actions.busy || !unlocked} required /></div></div>
    <Label htmlFor={`recovery-notes-${recovery.id}`}>Catatan dan referensi bukti</Label><Textarea id={`recovery-notes-${recovery.id}`} placeholder="Tanggal, hasil penagihan, dan referensi pembayaran…" value={notes} onChange={e => setNotes(e.target.value)} disabled={actions.busy || !unlocked} />
    <DocumentUpload kind="RECOVERY_UPDATE" contextKey={contextKey("recovery", chainId, recovery.id)} value={evidence} onUploaded={setEvidence} disabled={actions.busy || !unlocked} label="Bukti pemulihan (opsional)" />
    <p className="text-xs text-muted-foreground">Status pulih penuh dan dihapusbukukan bersifat final.</p>
    <Button type="submit" size="sm" disabled={actions.busy || !unlocked || (!notes.trim() && !evidence) || wrongNetwork}>Catat progres onchain</Button>
  </form>;
}

export default function ProviderPage() {
  const { address } = useAccount();
  const { deployment, chainId, wrongNetwork, configLoading } = useActiveChain();
  const client = usePublicClient({ chainId });
  const snapshot = useProtocolSnapshot();
  const balances = useBalances(address);
  const roles = useRoles(address);
  const [unlocked, unlockButton] = usePrivateAccess();
  const actions = usePageTransactions();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [faucetAmount, setFaucetAmount] = useState("100");
  useEffect(() => { setDepositAmount(""); setWithdrawAmount(""); }, [chainId, address]);
  const snap = snapshot.data;
  const now = snap?.blockTimestamp ?? 0;
  const ownedPositions = (snap?.protections ?? []).filter(p => sameAccount(p.provider, address));
  const ownedRecoveries = (snap?.recoveries ?? []).filter(r => sameAccount(r.owner, address));
  const ownedProtectionIds = new Set(ownedPositions.map(p => p.id));
  const relevantClaims = (snap?.claims ?? []).filter(c => ownedProtectionIds.has(c.protectionId));
  const pendingRequests = (snap?.requests ?? []).filter(r => r.status === RequestStatus.Pending && (sameAccount(r.provider, address) || /^0x0{40}$/i.test(r.provider)) && !sameAccount(r.buyer, address)).slice().reverse();
  const docs = useDocumentIndex(ownedRecoveries.flatMap(r => [r.lastUpdateHash, r.evidenceHash, r.decisionHash]), unlocked);
  const releaseGuard = useQuery({
    queryKey: ["protocol", "release-guards", chainId, address, ownedPositions.map(p => p.id)],
    enabled: !!deployment && !!client && ownedPositions.length > 0,
    refetchInterval: 5000,
    queryFn: async () => {
      const rows = await Promise.all(ownedPositions.map(async p => {
        const [blocked, deadline] = await Promise.all([
          client!.readContract({ address: deployment!.claimManager, abi: claimManagerAbi, functionName: "isReleaseBlocked", args: [BigInt(p.id)] }),
          client!.readContract({ address: deployment!.claimManager, abi: claimManagerAbi, functionName: "appealDeadlineOf", args: [BigInt(p.id)] }),
        ]);
        return [p.id, { blocked, deadline: Number(deadline) }] as const;
      }));
      return new Map(rows);
    },
  });

  const ready = !!deployment && !!client && !!address && !!snap && !wrongNetwork;
  const deposit = () => actions.run(async () => {
    if (!ready || !deployment || !client || !address || !roles.data?.provider) throw new Error("Deposit memerlukan wallet dengan PROVIDER_ROLE pada jaringan protokol.");
    const amount = exactAmount(depositAmount);
    if (amount === 0n) throw new Error("Jumlah deposit harus lebih dari nol.");
    const token = await client.readContract({ address: deployment.settlementToken, abi: mockEthAbi, functionName: "balanceOf", args: [address] });
    if (amount > token) throw new Error("Saldo mETH wallet tidak mencukupi.");
    if (!await ensureVaultAllowance(client, deployment.settlementToken, deployment.vault, address, amount, actions.tx)) return;
    const receipt = await actions.tx.send({ label: "Deposit collateral bebas", address: deployment.vault, abi: vaultAbi, functionName: "deposit", args: [amount] });
    if (receipt) setDepositAmount("");
  });
  const withdraw = () => actions.run(async () => {
    if (!ready || !deployment || !client || !address) throw new Error("Hubungkan wallet pada jaringan protokol.");
    const amount = exactAmount(withdrawAmount);
    const free = await client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "freeCollateral", args: [address] });
    if (amount === 0n || amount > free) throw new Error("Penarikan harus lebih dari nol dan maksimal saldo collateral bebas.");
    const receipt = await actions.tx.send({ label: "Tarik collateral bebas", address: deployment.vault, abi: vaultAbi, functionName: "withdraw", args: [amount] });
    if (receipt) setWithdrawAmount("");
  });
  const faucet = () => actions.run(async () => {
    if (!ready || !deployment?.mockToken) throw new Error("Faucet hanya tersedia untuk deployment MockETH.");
    const amount = exactAmount(faucetAmount);
    if (amount === 0n || amount > 1000n * 10n ** 18n) throw new Error("Faucet menerima di atas 0 dan maksimal 1.000 mETH per transaksi.");
    await actions.tx.send({ label: "Ambil mETH demo", address: deployment.settlementToken, abi: mockEthAbi, functionName: "faucet", args: [amount] });
  });
  const release = (id: number) => actions.run(async () => {
    if (!ready || !deployment || !client) throw new Error("Wallet dan RPC belum siap.");
    const blocked = await client.readContract({ address: deployment.claimManager, abi: claimManagerAbi, functionName: "isReleaseBlocked", args: [BigInt(id)] });
    if (blocked) throw new Error("Collateral masih terkunci oleh klaim aktif atau jendela banding.");
    await actions.tx.send({ label: `Lepas collateral proteksi #${id}`, address: deployment.vault, abi: vaultAbi, functionName: "releaseCollateral", args: [BigInt(id)] });
  });

  const unavailable = configLoading || snapshot.isLoading ? "Membaca konfigurasi dan kontrak…" : !deployment ? "Kontrak belum tersedia pada jaringan ini" : snapshot.error ? "Gagal membaca kontrak" : !snap ? "Data protokol belum tersedia" : null;
  return <>
    <PageHeader title="Dashboard Provider" eyebrow="Collateral & pemulihan" description="Kelola saldo bebas, collateral terikat, underwriting, dan progres Recovery Claim NFT dari wallet Anda." actions={<Button asChild variant="outline" size="sm"><Link href="/protection">Protection Center</Link></Button>} />
    {wrongNetwork && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Ganti wallet ke jaringan protokol untuk menggunakan tindakan onchain.</p>}
    {unavailable ? <EmptyState icon={AlertTriangle} title={unavailable} description={snapshot.error ? (snapshot.error as Error).message : "Konfigurasi deployment dan RPC diperlukan."} action={snapshot.error ? <Button variant="outline" onClick={() => snapshot.refetch()}>Coba lagi</Button> : undefined} /> : !address ? <EmptyState icon={Wallet} title="Hubungkan wallet provider" description="Saldo, proteksi yang didanai, dan Recovery NFT ditampilkan berdasarkan wallet yang terhubung." /> : <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Wallet} label="Saldo wallet" value={formatToken(balances.data?.token)} sub={balances.data ? `${formatUnits(balances.data.eth, 18)} ETH untuk gas` : "Membaca saldo…"} />
        <KpiCard icon={Coins} label="Collateral bebas" value={formatToken(balances.data?.free)} sub="Dapat ditarik atau dikunci untuk proteksi" />
        <KpiCard icon={LockKeyhole} label="Collateral terkunci" value={formatToken(balances.data?.locked)} sub="Terikat pada proteksi; tidak dapat ditarik" tone="teal" />
        <KpiCard icon={ShieldCheck} label="Proteksi didanai" value={ownedPositions.length} sub={`${ownedPositions.filter(p => p.status === ProtectionStatus.Active).length} posisi aktif`} />
      </div>
      {balances.error && <p className="mb-4 text-sm text-rose-700">Gagal membaca saldo: {(balances.error as Error).message}</p>}
      {roles.error && <p className="mb-4 text-sm text-rose-700">Gagal membaca peran: {(roles.error as Error).message}</p>}
      {!roles.data?.provider && <p className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm">Wallet ini belum memiliki PROVIDER_ROLE. Collateral bebas tetap dapat ditarik oleh pemiliknya.</p>}
      {!unlocked && <PrivateDataNotice action={unlockButton} />}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Deposit collateral</CardTitle><CardDescription>mETH berpindah dari wallet ke saldo bebas vault.</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={e => { e.preventDefault(); deposit(); }}><Label htmlFor="deposit-amount">Jumlah (mETH)</Label><Input id="deposit-amount" inputMode="decimal" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="10" required disabled={actions.busy || !roles.data?.provider} /><p className="text-xs text-muted-foreground">Allowance saat ini: {formatToken(balances.data?.allowance)}. Jika kurang, konfirmasi persetujuan token terlebih dahulu.</p><Button type="submit" disabled={actions.busy || !ready || !roles.data?.provider || !depositAmount}>Izinkan & deposit</Button></form></CardContent></Card>
        <Card><CardHeader><CardTitle>Tarik saldo bebas</CardTitle><CardDescription>Dana terkunci menunggu penyelesaian proteksi.</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={e => { e.preventDefault(); withdraw(); }}><Label htmlFor="withdraw-amount">Jumlah (mETH)</Label><Input id="withdraw-amount" inputMode="decimal" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} required disabled={actions.busy} /><Button variant="outline" size="sm" type="button" disabled={actions.busy || !balances.data} onClick={() => setWithdrawAmount(formatUnits(balances.data?.free ?? 0n, 18))}>Isi seluruh saldo bebas</Button><div><Button type="submit" disabled={actions.busy || !ready || !withdrawAmount}>Tarik ke wallet</Button></div></form></CardContent></Card>
        <Card><CardHeader><CardTitle>Faucet mETH</CardTitle><CardDescription>Token demo tanpa nilai, maksimal 1.000 mETH per transaksi.</CardDescription></CardHeader><CardContent>{deployment?.mockToken ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); faucet(); }}><Label htmlFor="faucet-amount">Jumlah (mETH)</Label><Input id="faucet-amount" inputMode="decimal" value={faucetAmount} onChange={e => setFaucetAmount(e.target.value)} required disabled={actions.busy} /><Button type="submit" variant="outline" disabled={actions.busy || !ready || !faucetAmount}>Ambil token demo</Button></form> : <p className="text-sm text-muted-foreground">Deployment ini tidak menyediakan faucet token demo.</p>}</CardContent></Card>
      </div>
      <TxStatus state={actions.tx.state} className="mt-4" />
      <h2 className="mb-3 mt-8 font-semibold text-navy">Permintaan underwriting</h2>
      {roles.data?.provider ? <ProtectionRequests requests={pendingRequests} unlocked={unlocked} actions={actions} emptyTitle="Belum ada permintaan untuk provider ini" /> : <EmptyState title="Peran provider diperlukan untuk underwriting" />}
      <h2 className="mb-3 mt-8 font-semibold text-navy">Proteksi & pelepasan collateral</h2>
      {releaseGuard.error && <p className="mb-3 text-sm text-rose-700">Gagal memeriksa guard klaim: {(releaseGuard.error as Error).message}</p>}
      {!ownedPositions.length ? <EmptyState title="Belum ada proteksi didanai wallet ini" /> : <div className="grid gap-4 xl:grid-cols-2">{ownedPositions.slice().reverse().map(p => {
        const right = snap?.supplyRights.find(r => r.id === p.supplyRightId);
        const guard = releaseGuard.data?.get(p.id);
        const finalSupply = right?.status === SupplyStatus.Fulfilled || right?.status === SupplyStatus.Closed;
        const releaseEligible = p.status !== ProtectionStatus.Released && p.lockedAmount > 0n && !p.claimOpen && guard?.blocked === false && (finalSupply || now > p.expiresAt);
        const reason = p.status === ProtectionStatus.Released ? "Collateral sudah dilepas." : p.claimOpen || guard?.blocked ? `Pelepasan diblokir oleh klaim aktif${guard && guard.deadline >= now ? ` / banding sampai ${formatDateTime(guard.deadline)}` : ""}.` : !guard ? "Memeriksa guard klaim…" : !finalSupply && now <= p.expiresAt ? "Menunggu pasokan terpenuhi / ditutup atau masa proteksi berakhir." : p.lockedAmount === 0n ? "Tidak ada collateral tersisa." : "Siap dilepas ke saldo bebas provider.";
        return <Card key={p.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Proteksi #{p.id} · <Link href={`/supply/${p.supplyRightId}`} className="text-teal-700 hover:underline">SR #{p.supplyRightId}</Link></CardTitle><StatusBadge {...protectionStatusLabel[p.status]} /></div></CardHeader><CardContent className="space-y-4"><dl className="grid gap-3 sm:grid-cols-2"><Field label="Buyer"><AddressChip address={p.beneficiary} /></Field><Field label="Berlaku sampai">{formatDateTime(p.expiresAt)}</Field><Field label="Terkunci">{formatToken(p.lockedAmount)}</Field><Field label="Kompensasi dibayar">{formatToken(p.paidAmount)}</Field><Field label="Sudah dilepas">{formatToken(p.releasedAmount)}</Field><Field label="Batas total coverage">{formatToken(p.coverageAmount)}</Field></dl><p className="text-xs text-muted-foreground">{reason} Dana yang dilepas tetap di vault sampai ditarik oleh pemilik.</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={actions.busy || !ready || !releaseEligible} onClick={() => release(p.id)}>Lepas collateral</Button><Button asChild variant="outline" size="sm"><Link href={`/verify?type=protection&id=${p.id}`}>Verifikasi NFT</Link></Button></div></CardContent></Card>;
      })}</div>}
      <Card className="mt-6"><CardHeader><CardTitle>Klaim pada proteksi saya</CardTitle></CardHeader><CardContent>{!relevantClaims.length ? <EmptyState title="Belum ada klaim" /> : <div className="space-y-3">{relevantClaims.slice().reverse().map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><Link href={`/claims?supply=${c.supplyRightId}&claim=${c.id}`} className="text-sm font-medium text-teal-700 hover:underline">Klaim #{c.id} · SR #{c.supplyRightId}</Link><p className="text-xs text-muted-foreground">Kerugian diajukan {formatToken(c.claimedLoss)} · payout {formatToken(c.payoutAmount)}</p></div><StatusBadge {...claimStatusLabel[c.status]} /></div>)}</div>}</CardContent></Card>
      <h2 className="mb-3 mt-8 font-semibold text-navy">Recovery Claim NFT</h2>
      <p className="mb-3 text-xs text-muted-foreground">NFT mencatat hak pemulihan hasil settlement. Subrogasi / pengalihan hak hukum memerlukan perjanjian tersendiri.</p>
      {docs.error && <p className="mb-3 text-sm text-rose-700">Dokumen privat: {(docs.error as Error).message}</p>}
      {!ownedRecoveries.length ? <EmptyState title="Belum ada Recovery NFT di wallet ini" description="Recovery NFT diterbitkan kepada provider dalam transaksi settlement klaim." /> : <div className="grid gap-4 xl:grid-cols-2">{ownedRecoveries.slice().reverse().map(r => <Card key={r.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Recovery #{r.id} · Klaim #{r.claimId}</CardTitle><StatusBadge {...recoveryStatusLabel[r.status]} /></div></CardHeader><CardContent className="space-y-4"><dl className="grid gap-3 sm:grid-cols-2"><Field label="Pasokan"><Link href={`/supply/${r.supplyRightId}`} className="text-teal-700 hover:underline">SR #{r.supplyRightId}</Link></Field><Field label="Settlement">{formatDateTime(r.settledAt)} · blok {r.settledBlock}</Field><Field label="Kompensasi dibayar">{formatToken(r.compensationAmount)}</Field><Field label="Target pemulihan">{formatToken(r.recoveryAmount)}</Field><Field label="Dilaporkan pulih">{formatToken(r.recoveredAmount)}</Field><Field label="Sisa pemulihan">{formatToken(r.recoveryAmount - r.recoveredAmount)}</Field><Field label="Bukti klaim"><DocumentHash hash={r.evidenceHash} doc={docs.map.get(r.evidenceHash.toLowerCase())} /></Field><Field label="Update terakhir"><DocumentHash hash={r.lastUpdateHash} doc={docs.map.get(r.lastUpdateHash.toLowerCase())} /></Field></dl><Button asChild variant="outline" size="sm"><Link href={`/verify?type=recovery&id=${r.id}`}>Verifikasi Recovery NFT</Link></Button><RecoveryEditor recovery={r} unlocked={unlocked} actions={actions} /></CardContent></Card>)}</div>}
      <Card className="mt-6"><CardHeader><CardTitle>Aktivitas wallet onchain</CardTitle></CardHeader><CardContent><AuditTimeline filter={e => Object.values(e.args).some(value => typeof value === "string" && sameAccount(value, address)) || ownedProtectionIds.has(Number(e.args.protectionId ?? 0)) || relevantClaims.some(c => c.id === Number(e.args.claimId ?? 0)) || ownedRecoveries.some(r => r.id === Number(e.args.tokenId ?? 0) && e.contract === "recoveryClaimNFT")} limit={30} /></CardContent></Card>
    </>}
  </>;
}

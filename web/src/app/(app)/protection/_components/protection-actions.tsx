"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { parseUnits, zeroAddress, type Address } from "viem";
import { toast } from "sonner";
import { vaultAbi, mockEthAbi } from "@/generated/abis";
import { useProtocolTx } from "@/hooks/use-protocol-tx";
import { useActiveChain, useBalances, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { useCreateTextDocument, useDocumentIndex } from "@/hooks/use-offchain";
import { AddressChip } from "@/components/onchain";
import { DocumentHash } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Field } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatBps, formatDateTime, formatToken } from "@/lib/format";
import { contextKey } from "@/lib/offchain-types";
import { RequestStatus, SupplyStatus, type ProtectionRequest } from "@/lib/protocol/types";
import { requestStatusLabel } from "@/lib/protocol/labels";

export const sameAccount = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm disabled:opacity-50";

/** Reject extra decimals before parseUnits can round; every submitted amount stays an exact uint256. */
export function exactAmount(value: string, decimals = 18): bigint {
  const input = value.trim().replace(",", ".");
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(input)) {
    throw new Error(`Masukkan angka positif dengan maksimal ${decimals} desimal, tanpa pemisah ribuan.`);
  }
  const amount = parseUnits(input, decimals);
  if (amount > (1n << 256n) - 1n) throw new Error("Jumlah melebihi batas kontrak.");
  return amount;
}

export function usePageTransactions() {
  const tx = useProtocolTx();
  const mutex = useRef(false);
  const [working, setWorking] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (mutex.current) return;
    mutex.current = true;
    setWorking(true);
    try {
      await action();
    } catch (error) {
      toast.error("Tindakan tidak dapat dilanjutkan", { description: error instanceof Error ? error.message : "Terjadi kesalahan." });
    } finally {
      mutex.current = false;
      setWorking(false);
    }
  };
  return { tx, run, busy: working || tx.busy };
}

export type PageTransactions = ReturnType<typeof usePageTransactions>;

/** Check allowance against the live chain, and advance only after a successful approval receipt. */
export async function ensureVaultAllowance(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  token: Address,
  vault: Address,
  account: Address,
  amount: bigint,
  tx: PageTransactions["tx"],
) {
  const allowance = await client.readContract({ address: token, abi: mockEthAbi, functionName: "allowance", args: [account, vault] });
  if (allowance >= amount) return true;
  const receipt = await tx.send({ label: "Izinkan transfer mETH ke vault", address: token, abi: mockEthAbi, functionName: "approve", args: [vault, amount] });
  if (!receipt) return false;
  const confirmed = await client.readContract({ address: token, abi: mockEthAbi, functionName: "allowance", args: [account, vault] });
  if (confirmed < amount) throw new Error("Allowance setelah konfirmasi belum mencukupi.");
  return true;
}

export function ProtectionRequests({ requests, unlocked, actions, emptyTitle = "Belum ada permintaan proteksi" }: {
  requests: ProtectionRequest[];
  unlocked: boolean;
  actions: PageTransactions;
  emptyTitle?: string;
}) {
  const { address } = useAccount();
  const { deployment, chainId, wrongNetwork } = useActiveChain();
  const client = usePublicClient({ chainId });
  const roles = useRoles(address);
  const balances = useBalances(address);
  const snapshot = useProtocolSnapshot();
  const memo = useCreateTextDocument();
  const docs = useDocumentIndex(requests.flatMap(r => [r.termsHash, r.decisionHash]), unlocked);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const { tx, run, busy } = actions;
  const now = snapshot.data?.blockTimestamp ?? 0;
  useEffect(() => { setNotes({}); }, [chainId, address]);

  const decide = async (r: ProtectionRequest, approve: boolean) => run(async () => {
    if (!address || !client || !deployment || wrongNetwork) throw new Error("Wallet dan jaringan protokol harus siap.");
    if (!unlocked) throw new Error("Buka akses data privat untuk menyimpan memo keputusan.");
    const content = notes[r.id]?.trim();
    if (!content) throw new Error("Isi memo underwriting atau alasan penolakan terlebih dahulu.");
    if (!roles.data?.provider || (!sameAccount(r.provider, zeroAddress) && !sameAccount(r.provider, address))) {
      throw new Error("Wallet ini bukan provider yang dapat memutuskan permintaan tersebut.");
    }
    if (approve && sameAccount(r.buyer, address)) throw new Error("Buyer tidak dapat memberi proteksi kepada dirinya sendiri.");
    const document = await memo.mutateAsync({ kind: "UNDERWRITING_MEMO", title: `${approve ? "Persetujuan" : "Penolakan"} proteksi #${r.id}`, content, contextKey: contextKey("request", chainId, r.id) });
    if (!approve) {
      await tx.send({ label: `Tolak permintaan #${r.id}`, address: deployment.vault, abi: vaultAbi, functionName: "rejectRequest", args: [BigInt(r.id), document.sha256] });
      return;
    }
    const free = await client.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "freeCollateral", args: [address] });
    if (free >= r.coverageAmount) {
      await tx.send({ label: `Aktifkan proteksi permintaan #${r.id}`, address: deployment.vault, abi: vaultAbi, functionName: "approveProtection", args: [BigInt(r.id), document.sha256] });
      return;
    }
    const shortfall = r.coverageAmount - free;
    const token = await client.readContract({ address: deployment.settlementToken, abi: mockEthAbi, functionName: "balanceOf", args: [address] });
    if (token < shortfall) throw new Error(`Saldo wallet kurang ${formatToken(shortfall - token)}. Ambil token demo atau tambah saldo terlebih dahulu.`);
    if (!await ensureVaultAllowance(client, deployment.settlementToken, deployment.vault, address, shortfall, tx)) return;
    await tx.send({ label: `Danai & aktifkan proteksi #${r.id}`, address: deployment.vault, abi: vaultAbi, functionName: "fundAndApproveProtection", args: [BigInt(r.id), document.sha256] });
  });

  if (!requests.length) return <EmptyState title={emptyTitle} />;
  return <div className="space-y-4">
    {docs.error && <p className="text-sm text-rose-700">Dokumen privat: {(docs.error as Error).message}</p>}
    {requests.map(r => {
      const label = requestStatusLabel[r.status];
      const providerAllowed = !!roles.data?.provider && (sameAccount(r.provider, zeroAddress) || sameAccount(r.provider, address));
      const pending = r.status === RequestStatus.Pending;
      const right = snapshot.data?.supplyRights.find(sr => sr.id === r.supplyRightId);
      const expired = now >= r.expiresAt;
      const eligible = right && [SupplyStatus.Registered, SupplyStatus.Active].includes(right.status) && !right.protectionId && sameAccount(right.owner, r.buyer);
      const shortfall = r.coverageAmount > (balances.data?.free ?? 0n) ? r.coverageAmount - (balances.data?.free ?? 0n) : 0n;
      return <Card key={r.id}>
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Permintaan #{r.id} · <Link href={`/supply/${r.supplyRightId}`} className="text-teal-700 hover:underline">SR #{r.supplyRightId}</Link></CardTitle><StatusBadge {...label} /></div></CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Buyer"><AddressChip address={r.buyer} /></Field>
            <Field label="Provider">{sameAccount(r.provider, zeroAddress) ? "Terbuka untuk provider berizin" : <AddressChip address={r.provider} />}</Field>
            <Field label="Batas total kompensasi">{formatToken(r.coverageAmount)}</Field>
            <Field label="Porsi kerugian terverifikasi">{formatBps(r.coverageBps)}</Field>
            <Field label="Berlaku sampai"><span className={expired && pending ? "text-rose-700" : ""}>{formatDateTime(r.expiresAt)}</span></Field>
            <Field label="Diajukan">{formatDateTime(r.requestedAt)}</Field>
            <Field label="Syarat proteksi"><DocumentHash hash={r.termsHash} doc={docs.map.get(r.termsHash.toLowerCase())} /></Field>
            <Field label="Memo keputusan"><DocumentHash hash={r.decisionHash} doc={docs.map.get(r.decisionHash.toLowerCase())} /></Field>
          </dl>
          {r.protectionId > 0 && <Button asChild variant="outline" size="sm"><Link href={`/verify?type=protection&id=${r.protectionId}`}>Lihat Protection NFT #{r.protectionId}</Link></Button>}
          {pending && sameAccount(r.buyer, address) && <Button variant="outline" size="sm" disabled={busy || !deployment || wrongNetwork} onClick={() => run(async () => { if (!deployment) return; await tx.send({ label: `Batalkan permintaan #${r.id}`, address: deployment.vault, abi: vaultAbi, functionName: "cancelRequest", args: [BigInt(r.id)] }); })}>Batalkan permintaan</Button>}
          {pending && providerAllowed && <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <label htmlFor={`underwriting-${r.id}`} className="text-sm font-medium">Memo underwriting / alasan penolakan</label>
            <Textarea id={`underwriting-${r.id}`} value={notes[r.id] ?? ""} onChange={e => setNotes(previous => ({ ...previous, [r.id]: e.target.value }))} placeholder="Hasil penilaian risiko dan dasar keputusan…" disabled={busy || !unlocked} />
            {expired ? <p className="text-xs text-rose-700">Permintaan telah kedaluwarsa. Buyer dapat membatalkan lalu membuat permintaan baru.</p> : !eligible ? <p className="text-xs text-amber-700">Supply Right saat ini tidak memenuhi syarat aktivasi.</p> : <p className="text-xs text-muted-foreground">{shortfall > 0n ? `Vault akan menarik kekurangan ${formatToken(shortfall)} dari wallet setelah allowance dikonfirmasi.` : "Seluruh coverage akan dikunci dari collateral bebas."} Protection NFT diterbitkan oleh kontrak saat aktivasi.</p>}
            {!unlocked && <p className="text-xs text-muted-foreground">Buka data privat untuk menyimpan memo keputusan.</p>}
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !unlocked || !notes[r.id]?.trim() || expired || !eligible || sameAccount(r.buyer, address) || wrongNetwork || !client} onClick={() => decide(r, true)}>{shortfall > 0n ? "Danai & setujui" : "Setujui proteksi"}</Button><Button size="sm" variant="outline" disabled={busy || !unlocked || !notes[r.id]?.trim() || wrongNetwork || !client} onClick={() => decide(r, false)}>Tolak permintaan</Button></div>
          </div>}
        </CardContent>
      </Card>;
    })}
  </div>;
}

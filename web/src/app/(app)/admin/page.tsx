"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { Settings, ShieldCheck, Users } from "lucide-react";
import { claimManagerAbi, supplyRightNftAbi } from "@/generated/abis";
import { useActiveChain, useProtocolSnapshot } from "@/hooks/use-protocol";
import { useChainRead } from "@/hooks/claims-chain-read";
import { useProtocolTx } from "@/hooks/use-protocol-tx";
import { PageHeader, EmptyState, Field } from "@/components/page";
import { AddressChip } from "@/components/onchain";
import { TxStatus } from "@/components/tx-status";
import { AuditTimeline } from "@/components/audit-timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ROLES } from "@/lib/protocol/roles";
import { CONTRACT_LABELS } from "@/lib/deployments";
import { formatDuration } from "@/lib/format";

const OPERATIONS = {
  buyer: { label: "Pembeli / Manufaktur", field: "supplyRightNFT", role: ROLES.BUYER_ROLE },
  registrar: { label: "Registrar Kontrak", field: "supplyRightNFT", role: ROLES.REGISTRAR_ROLE },
  provider: { label: "Penyedia Proteksi", field: "vault", role: ROLES.PROVIDER_ROLE },
  verifier: { label: "Verifikator Independen", field: "claimManager", role: ROLES.VERIFIER_ROLE },
} as const;
type Operation = keyof typeof OPERATIONS;

export default function AdminPage() {
  const { address } = useAccount();
  const { deployment, configLoading } = useActiveChain();
  const snapshot = useProtocolSnapshot();
  const tx = useProtocolTx();
  const [operation, setOperation] = useState<Operation>("buyer");
  const [target, setTarget] = useState("");
  const [delay, setDelay] = useState("");
  const [appeal, setAppeal] = useState("");
  const selected = OPERATIONS[operation];
  const targetAddress = isAddress(target) && getAddress(target) !== zeroAddress ? getAddress(target) : undefined;
  const permission = useChainRead(["role-management", operation, targetAddress, address], async (client, d) => {
    const contract = d[selected.field];
    const [administrator, member] = await Promise.all([
      address ? client.readContract({ address: contract, abi: supplyRightNftAbi, functionName: "hasRole", args: [ROLES.DEFAULT_ADMIN_ROLE, address] }) : false,
      targetAddress ? client.readContract({ address: contract, abi: supplyRightNftAbi, functionName: "hasRole", args: [selected.role, targetAddress] }) : false,
    ]);
    return { administrator, member };
  });
  const settingsPermission = useChainRead(["settings-admin", address], (client, d) =>
    client.readContract({ address: d.claimManager, abi: claimManagerAbi, functionName: "hasRole", args: [ROLES.DEFAULT_ADMIN_ROLE, address!] }),
    { enabled: !!address });
  const changeRole = (grant: boolean) => {
    if (!deployment || !targetAddress || !permission.data?.administrator) return;
    void tx.send({ label: (grant ? "Berikan peran " : "Cabut peran ") + selected.label, address: deployment[selected.field],
      abi: supplyRightNftAbi, functionName: grant ? "grantRole" : "revokeRole", args: [selected.role, targetAddress] });
  };
  const validSeconds = (value: string, maximum: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum;
  const updateWindow = (name: "setSettlementDelay" | "setAppealWindow", value: string) => {
    if (!deployment || !settingsPermission.data || !validSeconds(value, name === "setSettlementDelay" ? 30 * 86400 : 90 * 86400)) return;
    void tx.send({ label: name === "setSettlementDelay" ? "Ubah jeda settlement" : "Ubah jendela banding", address: deployment.claimManager,
      abi: claimManagerAbi, functionName: name, args: [BigInt(value)] });
  };

  return <>
    <PageHeader eyebrow="Platform Operations" title="Admin & Peran" description="Peran dan jendela keputusan dibaca serta diubah langsung pada kontrak. Hanya administrator kontrak terkait yang dapat mengubahnya." />
    {configLoading ? <EmptyState title="Memuat konfigurasi kontrak…" /> : !deployment ? <EmptyState title="Kontrak belum tersedia" description="Konfigurasikan deployment jaringan sebelum mengelola peran." /> : <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" /> Onboarding peran</CardTitle><CardDescription>Alamat peserta harus mempunyai peran yang sesuai sebelum menjalankan alur aplikasi.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><Label htmlFor="admin-role">Peran</Label><Select value={operation} onValueChange={(value) => setOperation(value as Operation)}><SelectTrigger id="admin-role" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(OPERATIONS).map(([key, value]) => <SelectItem key={key} value={key}>{value.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="admin-wallet">Alamat wallet peserta</Label><Input id="admin-wallet" placeholder="0x…" value={target} onChange={(e) => setTarget(e.target.value.trim())} autoComplete="off" /></div>
            <Field label="Kontrak yang mengatur peran"><AddressChip address={deployment[selected.field]} /></Field>
            {target && !targetAddress && <p role="alert" className="text-xs text-rose-700">Masukkan alamat EVM yang valid dan bukan alamat nol.</p>}
            {permission.error ? <p role="alert" className="text-xs text-rose-700">Gagal membaca peran: {(permission.error as Error).message}</p> : <p className="text-sm text-muted-foreground">{permission.isFetching ? "Memeriksa peran…" : targetAddress ? (permission.data?.member ? "Wallet ini sudah memiliki peran." : "Wallet ini belum memiliki peran.") : "Masukkan alamat untuk memeriksa peran."}</p>}
            <div className="flex flex-wrap gap-2"><Button disabled={tx.busy || permission.isFetching || !targetAddress || !permission.data?.administrator || permission.data.member} onClick={() => changeRole(true)}>Berikan peran</Button><Button variant="outline" disabled={tx.busy || permission.isFetching || !targetAddress || !permission.data?.administrator || !permission.data.member} onClick={() => changeRole(false)}>Cabut peran</Button></div>
            {!address ? <p className="text-xs text-muted-foreground">Hubungkan wallet administrator untuk mengubah peran.</p> : permission.data && !permission.data.administrator && <p className="text-xs text-muted-foreground">Wallet terhubung tidak memiliki DEFAULT_ADMIN_ROLE pada kontrak ini.</p>}
            <p className="text-xs text-muted-foreground">Verifikator harus independen dari pembeli dan provider pada klaim yang dinilainya. Pencabutan peran provider tidak menahan collateral bebas miliknya.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="size-4" /> Jendela keputusan klaim</CardTitle><CardDescription>Batas onchain: jeda settlement maksimal 30 hari; jendela banding maksimal 90 hari.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {snapshot.error && <p role="alert" className="text-xs text-rose-700">Gagal memuat pengaturan: {(snapshot.error as Error).message}</p>}
            <div><Label htmlFor="admin-delay">Jeda settlement (detik)</Label><Input id="admin-delay" type="number" min={0} max={2592000} step={1} value={delay} placeholder={String(snapshot.data?.settings.settlementDelay ?? "")} onChange={(e) => setDelay(e.target.value)} /><p className="my-2 text-xs text-muted-foreground">Saat ini: {snapshot.data ? formatDuration(snapshot.data.settings.settlementDelay) : "memuat…"}</p><Button variant="outline" disabled={tx.busy || !settingsPermission.data || !validSeconds(delay, 2592000)} onClick={() => updateWindow("setSettlementDelay", delay)}>Simpan jeda settlement</Button></div>
            <div><Label htmlFor="admin-appeal">Jendela banding (detik)</Label><Input id="admin-appeal" type="number" min={0} max={7776000} step={1} value={appeal} placeholder={String(snapshot.data?.settings.appealWindow ?? "")} onChange={(e) => setAppeal(e.target.value)} /><p className="my-2 text-xs text-muted-foreground">Saat ini: {snapshot.data ? formatDuration(snapshot.data.settings.appealWindow) : "memuat…"}</p><Button variant="outline" disabled={tx.busy || !settingsPermission.data || !validSeconds(appeal, 7776000)} onClick={() => updateWindow("setAppealWindow", appeal)}>Simpan jendela banding</Button></div>
            <p className="text-xs text-muted-foreground">Pengaturan ini berlaku global. Collateral terikat hanya dapat dibayar melalui settlement klaim atau dilepas saat kondisi kontrak mengizinkan.</p>
          </CardContent>
        </Card>
      </div>
      <TxStatus state={tx.state} className="mt-4" />
      <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Alamat kontrak aktif</CardTitle><CardDescription>Alamat berasal dari konfigurasi deployment; pencatatan NFT dan escrow ETH di vault dapat diverifikasi publik.</CardDescription></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(CONTRACT_LABELS).map(([key, label]) => <Field key={key} label={label}><AddressChip address={deployment[key as keyof typeof CONTRACT_LABELS] as Address} /></Field>)}</dl></CardContent></Card>
      <Card className="mt-6"><CardHeader><CardTitle>Riwayat administrasi onchain</CardTitle></CardHeader><CardContent><AuditTimeline filter={(event) => ["RoleGranted", "RoleRevoked", "SettlementDelayUpdated", "AppealWindowUpdated"].includes(event.name)} /></CardContent></Card>
    </>}
  </>;
}

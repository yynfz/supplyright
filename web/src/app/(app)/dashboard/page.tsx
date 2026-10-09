"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Clock,
  Factory,
  FileWarning,
  Gauge,
  ShieldCheck,
  ShieldOff,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditTimeline } from "@/components/audit-timeline";
import { EmptyState, KpiCard, Meter, PageHeader } from "@/components/page";
import { PrivateDataNotice, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { useProtocolSnapshot } from "@/hooks/use-protocol";
import { useAgreements, useProductionMap } from "@/hooks/use-offchain";
import { computeProductionRisk, computeSupplyKpis, MATERIAL_STATE } from "@/lib/risk";
import { claimStatusLabel, supplyStatusLabel } from "@/lib/protocol/labels";
import { formatDate, formatQty, formatRelative, formatToken } from "@/lib/format";
import { ClaimStatus } from "@/lib/protocol/types";

export default function DashboardPage() {
  const snapshot = useProtocolSnapshot();
  const [unlocked, unlockButton] = usePrivateAccess();
  const production = useProductionMap(unlocked);
  const agreements = useAgreements(unlocked);

  const snap = snapshot.data;
  const now = snap?.blockTimestamp ?? Math.floor(Date.now() / 1000);
  const kpi = computeSupplyKpis(snap);
  const risk = computeProductionRisk(production.data, snap, now);
  const agreementByPo = new Map((agreements.data ?? []).map((a) => [a.po_hash.toLowerCase(), a]));
  const protectedRatio = kpi.outstandingValue > 0n ? Number((kpi.protectedExposure * 10_000n) / kpi.outstandingValue) / 10_000 : 0;

  return (
    <>
      <PageHeader
        eyebrow="Ringkasan risiko pasokan"
        title="Dashboard Eksekutif"
        description="Komitmen pasokan, eksposur finansial, dan dampak produksi. Angka finansial dibaca langsung dari kontrak; dampak produksi adalah estimasi offchain."
        actions={!unlocked && unlockButton}
      />

      {snapshot.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : snapshot.error ? (
        <EmptyState icon={AlertTriangle} title="Gagal membaca kontrak" description={(snapshot.error as Error).message} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Komitmen pasokan aktif" value={kpi.activeCommitments} sub={`${snap?.supplyRights.length ?? 0} Supply Right tercatat`} icon={Boxes} />
          <KpiCard label="Nilai pasokan belum terkirim" value={formatToken(kpi.outstandingValue)} sub="Nilai kontrak atas kuantitas tersisa" icon={Wallet} />
          <KpiCard label="PO terlambat" value={kpi.delayed.length} sub="Lewat tenggat, belum lengkap" icon={Clock} tone={kpi.delayed.length ? "danger" : "neutral"} />
          <KpiCard label="Klaim tertunda" value={kpi.pendingClaims} sub="Menunggu verifikasi / settlement" icon={FileWarning} tone={kpi.pendingClaims ? "warning" : "neutral"} />
          <KpiCard label="Eksposur terproteksi" value={formatToken(kpi.protectedExposure)} sub="Dibatasi collateral terkunci" icon={ShieldCheck} tone="teal" />
          <KpiCard label="Eksposur tanpa proteksi" value={formatToken(kpi.unprotectedExposure)} sub="Risiko yang ditanggung sendiri" icon={ShieldOff} tone={kpi.unprotectedExposure > 0n ? "danger" : "neutral"} />
          <KpiCard
            label="Material kritis berisiko"
            value={unlocked ? risk.criticalAtRisk.length : "—"}
            sub={unlocked ? `${risk.affectedDependencies} dependensi produksi terdampak` : "Buka data privat"}
            icon={Factory}
            tone={risk.criticalAtRisk.length ? "danger" : "neutral"}
            estimate={unlocked}
          />
          <KpiCard label="Kompensasi diterima" value={formatToken(kpi.compensationPaid)} sub="Settlement klaim onchain" icon={Banknote} tone="success" />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Risiko pasokan per Supply Right</CardTitle>
            <CardDescription>Nilai belum terkirim vs. bagian yang dilindungi collateral terkunci.</CardDescription>
          </CardHeader>
          <CardContent>
            {kpi.perRight.length === 0 ? (
              <EmptyState title="Belum ada komitmen pasokan aktif" action={<Button asChild size="sm"><Link href="/registry">Daftarkan pasokan</Link></Button>} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supply Right</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tenggat</TableHead>
                    <TableHead className="text-right">Belum terkirim</TableHead>
                    <TableHead className="w-40">Terproteksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpi.perRight.map(({ right, outstanding, protectedAmount }) => {
                    const a = agreementByPo.get(right.poRefHash.toLowerCase());
                    const s = supplyStatusLabel[right.status];
                    const late = now > right.deliveryDeadline && right.deliveredQuantity < right.orderedQuantity;
                    return (
                      <TableRow key={right.id}>
                        <TableCell>
                          <Link href={`/supply/${right.id}`} className="font-medium text-navy hover:underline">
                            SR #{right.id}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {a ? `${a.material_name} · ${a.po_number}` : `${formatQty(right.orderedQuantity, right.unit)} dipesan`}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge label={s.label} tone={s.tone} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={late ? "font-medium text-rose-700" : ""}>{formatDate(right.deliveryDeadline)}</span>
                          <p className="text-muted-foreground">{formatRelative(right.deliveryDeadline, now)}</p>
                        </TableCell>
                        <TableCell className="tabular text-right">{formatToken(outstanding)}</TableCell>
                        <TableCell>
                          <Meter value={outstanding > 0n ? Number((protectedAmount * 1000n) / outstanding) / 1000 : 0} />
                          <p className="mt-1 text-xs text-muted-foreground">{formatToken(protectedAmount)}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Perlindungan finansial</CardTitle>
            <CardDescription>Dari vault SupplyRight (onchain).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">Rasio terproteksi</span>
                <span className="font-medium">{(protectedRatio * 100).toFixed(1)}%</span>
              </div>
              <Meter value={protectedRatio} tone="teal" />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Collateral terkunci</dt>
                <dd className="tabular font-semibold">{formatToken(snap?.vault.totalLocked)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Collateral bebas</dt>
                <dd className="tabular font-semibold">{formatToken(snap?.vault.totalFree)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total dibayarkan</dt>
                <dd className="tabular font-semibold">{formatToken(snap?.vault.totalPaidOut)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Saldo vault</dt>
                <dd className="tabular font-semibold">{formatToken(snap?.vault.tokenBalance)}</dd>
              </div>
            </dl>
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Gauge className="mb-1 size-4 text-teal-600" />
              Invarian vault: saldo token ≥ collateral bebas + terkunci. Admin tidak memiliki fungsi penarikan.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Dampak produksi</CardTitle>
            <CardDescription>
              Estimasi offchain dari Production Dependency Mapper. Bukan fakta terverifikasi.{" "}
              <Link href="/production" className="text-teal-700 hover:underline">
                Kelola peta dependensi →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!unlocked ? (
              <PrivateDataNotice action={unlockButton} />
            ) : production.isLoading ? (
              <Skeleton className="h-32" />
            ) : production.error ? (
              <p className="text-sm text-rose-700">{(production.error as Error).message}</p>
            ) : risk.products.length === 0 ? (
              <EmptyState title="Peta dependensi produksi masih kosong" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {risk.products.map((p) => (
                  <div key={p.product.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-navy">{p.product.name}</p>
                        <p className="text-xs text-muted-foreground">{p.product.sku}</p>
                      </div>
                      <StatusBadge
                        label={p.level === "DISRUPTED" ? "Berisiko terhenti" : p.level === "WATCH" ? "Waspada" : "Normal"}
                        tone={p.level === "DISRUPTED" ? "danger" : p.level === "WATCH" ? "warning" : "success"}
                      />
                    </div>
                    <ul className="mt-3 space-y-1 text-xs">
                      {p.dependencies.map(({ dep, material }) => {
                        const st = MATERIAL_STATE[material.state];
                        return (
                          <li key={dep.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{material.material.name}</span>
                            <StatusBadge label={st.label} tone={st.tone} />
                          </li>
                        );
                      })}
                    </ul>
                    {p.level === "DISRUPTED" && (
                      <p className="mt-3 rounded bg-rose-50 p-2 text-xs text-rose-800">
                        Estimasi gangguan {p.estDisruptionDays} hari · eksposur {formatToken(p.estExposure)}
                        {p.strandedMaterials.length > 0 &&
                          ` · ${p.strandedMaterials.map((m) => m.material.name).join(", ")} sudah tiba namun tertahan`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivitas terbaru</CardTitle>
            <CardDescription>Event kontrak — sumber kebenaran audit.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[28rem] overflow-y-auto">
            <AuditTimeline importantOnly limit={12} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Linimasa klaim</CardTitle>
          <CardDescription>Status setiap klaim default dan kompensasinya.</CardDescription>
        </CardHeader>
        <CardContent>
          {!snap || snap.claims.length === 0 ? (
            <EmptyState title="Belum ada klaim" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Klaim</TableHead>
                  <TableHead>Supply Right</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Diajukan</TableHead>
                  <TableHead className="text-right">Kerugian diklaim</TableHead>
                  <TableHead className="text-right">Kompensasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...snap.claims].reverse().map((c) => {
                  const s = claimStatusLabel[c.status];
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/claims?claim=${c.id}`} className="font-medium text-navy hover:underline">
                          Klaim #{c.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/supply/${c.supplyRightId}`} className="hover:underline">
                          SR #{c.supplyRightId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge label={s.label} tone={s.tone} />
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(c.submittedAt)}</TableCell>
                      <TableCell className="tabular text-right">{formatToken(c.claimedLoss)}</TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {c.status === ClaimStatus.Settled || c.status === ClaimStatus.Approved ? formatToken(c.payoutAmount) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

"use client";

import Link from "next/link";
import { AlertTriangle, Boxes, CalendarClock, Factory, PackageX, ShieldAlert, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState, KpiCard, Meter, PageHeader } from "@/components/page";
import { PrivateDataNotice, usePrivateAccess } from "@/components/private-data";
import { StatusBadge } from "@/components/status-badge";
import { useAccount } from "wagmi";
import { useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { useAgreements, useProductionMap } from "@/hooks/use-offchain";
import { CRITICALITY, MATERIAL_STATE, computeProductionRisk, effectiveDisruptionDays } from "@/lib/risk";
import { undeliveredValue } from "@/lib/protocol/snapshot";
import { formatDate, formatQty, formatRelative, formatToken } from "@/lib/format";
import { DependencyGraph } from "./_components/dependency-graph";
import { DeleteButton, DependencyDialog, MaterialDialog, ProductDialog } from "./_components/editors";

export default function ProductionRiskPage() {
  const { address } = useAccount();
  const roles = useRoles(address);
  const snapshot = useProtocolSnapshot();
  const [unlocked, unlockButton] = usePrivateAccess();
  const production = useProductionMap(unlocked);
  const agreements = useAgreements(unlocked);

  const snap = snapshot.data;
  const now = snap?.blockTimestamp ?? Math.floor(Date.now() / 1000);
  const risk = computeProductionRisk(production.data, snap, now);
  const canEdit = !!(roles.data?.buyer || roles.data?.registrar || roles.data?.admin);
  const disrupted = risk.products.filter((p) => p.level === "DISRUPTED");
  const unitsLost = disrupted.reduce((s, p) => s + (p.product.daily_output_units ?? 0) * p.estDisruptionDays, 0);
  const warnings = risk.materials.filter((m) => m.right && (MATERIAL_STATE[m.state].disrupting || m.state === "AT_RISK"));

  return (
    <>
      <PageHeader
        eyebrow="Production Dependency Mapper"
        title="Production Risk"
        description="Memetakan material ke produk dan menunjukkan produk yang berisiko terhenti ketika satu material kritis terlambat — meskipun material lain sudah tiba. Logika berjalan offchain; semua dampak adalah estimasi, bukan fakta terverifikasi."
        actions={
          unlocked && canEdit && production.data ? (
            <>
              <MaterialDialog agreements={agreements.data ?? []} />
              <ProductDialog />
              <DependencyDialog materials={production.data.materials} products={production.data.products} />
            </>
          ) : (
            !unlocked && unlockButton
          )
        }
      />

      {!unlocked ? (
        <PrivateDataNotice action={unlockButton} />
      ) : production.isLoading || snapshot.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : production.error ? (
        <EmptyState icon={ShieldAlert} title="Tidak dapat memuat peta produksi" description={(production.error as Error).message} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Material kritis berisiko"
              value={risk.criticalAtRisk.length}
              sub={`${risk.materials.filter((m) => MATERIAL_STATE[m.state].disrupting).length} dari ${risk.materials.length} material terganggu`}
              icon={AlertTriangle}
              tone={risk.criticalAtRisk.length ? "danger" : "neutral"}
              estimate
            />
            <KpiCard
              label="Produk berisiko terhenti"
              value={disrupted.length}
              sub={`${risk.affectedDependencies} dependensi produksi terdampak`}
              icon={Factory}
              tone={disrupted.length ? "danger" : "neutral"}
              estimate
            />
            <KpiCard
              label="Estimasi output hilang"
              value={`${unitsLost.toLocaleString("id-ID")} unit`}
              sub={`Gangguan terpanjang ${Math.max(0, ...disrupted.map((p) => p.estDisruptionDays))} hari`}
              icon={CalendarClock}
              tone={unitsLost ? "warning" : "neutral"}
              estimate
            />
            <KpiCard
              label="Estimasi eksposur produksi"
              value={formatToken(risk.totalEstExposure)}
              sub="Di luar nilai PO yang belum terkirim"
              icon={Wallet}
              tone={risk.totalEstExposure > 0n ? "danger" : "neutral"}
              estimate
            />
          </div>

          {warnings.length > 0 && (
            <div className="mt-6 space-y-3">
              {warnings.map((m) => {
                const st = MATERIAL_STATE[m.state];
                const r = m.right!;
                const protection = snap?.protections.find((p) => p.id === r.protectionId);
                return (
                  <Alert key={m.material.id} variant={st.disrupting ? "destructive" : "default"}>
                    <AlertTriangle />
                    <AlertTitle>
                      {m.material.name}: {st.label} — SR #{r.id}
                    </AlertTitle>
                    <AlertDescription>
                      <p>
                        Tenggat {formatDate(r.deliveryDeadline)} ({formatRelative(r.deliveryDeadline, now)}) · diterima{" "}
                        {formatQty(r.deliveredQuantity, r.unit)} dari {formatQty(r.orderedQuantity, r.unit)} · nilai belum terkirim{" "}
                        {formatToken(undeliveredValue(r, r.deliveredQuantity))}.{" "}
                        {protection
                          ? `Terproteksi hingga ${formatToken(protection.lockedAmount)} (collateral terkunci).`
                          : "Tidak ada proteksi berdana."}{" "}
                        Produk terdampak: {m.products.map((p) => p.name).join(", ") || "-"}.
                      </p>
                      <p className="mt-1 flex gap-3">
                        <Link className="font-medium underline" href={`/supply/${r.id}`}>
                          Detail Supply Right
                        </Link>
                        {protection && st.disrupting && (
                          <Link className="font-medium underline" href="/claims">
                            Ajukan klaim
                          </Link>
                        )}
                      </p>
                    </AlertDescription>
                  </Alert>
                );
              })}
            </div>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Peta dependensi material → produk</CardTitle>
              <CardDescription>
                Garis merah: material wajib yang terganggu. Garis putus-putus: material tidak wajib. Status material diturunkan dari
                Supply Right onchain (via hash PO) atau laporan offchain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {risk.materials.length === 0 && risk.products.length === 0 ? (
                <EmptyState
                  icon={Boxes}
                  title="Peta dependensi masih kosong"
                  description="Tambahkan material, produk, dan relasinya. Jalankan `npm run seed:offchain` untuk data demo."
                />
              ) : (
                <DependencyGraph risk={risk} />
              )}
            </CardContent>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {risk.products.map((p) => (
              <Card key={p.product.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle>{p.product.name}</CardTitle>
                      <CardDescription>
                        {p.product.sku}
                        {p.product.daily_output_units ? ` · ${p.product.daily_output_units} unit/hari` : ""}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusBadge
                        label={p.level === "DISRUPTED" ? "Berisiko terhenti" : p.level === "WATCH" ? "Waspada" : "Normal"}
                        tone={p.level === "DISRUPTED" ? "danger" : p.level === "WATCH" ? "warning" : "success"}
                      />
                      {canEdit && <ProductDialog product={p.product} />}
                      {canEdit && <DeleteButton type="product" id={p.product.id} label={`produk ${p.product.name}`} />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {p.level === "DISRUPTED" && (
                    <div className="mb-4 grid grid-cols-3 gap-3 rounded-md bg-rose-50 p-3 text-xs text-rose-900">
                      <div>
                        <p className="text-rose-700">Gangguan (estimasi)</p>
                        <p className="text-base font-semibold">{p.estDisruptionDays} hari</p>
                      </div>
                      <div>
                        <p className="text-rose-700">Output hilang</p>
                        <p className="text-base font-semibold">
                          {((p.product.daily_output_units ?? 0) * p.estDisruptionDays).toLocaleString("id-ID")} unit
                        </p>
                      </div>
                      <div>
                        <p className="text-rose-700">Eksposur</p>
                        <p className="text-base font-semibold">{formatToken(p.estExposure)}</p>
                      </div>
                      {p.strandedMaterials.length > 0 && (
                        <p className="col-span-3 flex items-start gap-1.5">
                          <PackageX className="mt-0.5 size-3.5 shrink-0" />
                          {p.strandedMaterials.map((m) => m.material.name).join(", ")} sudah tiba namun tidak dapat dipakai —
                          modal kerja tertahan.
                        </p>
                      )}
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Gangguan</TableHead>
                        <TableHead className="text-right">Eksposur</TableHead>
                        {canEdit && <TableHead className="w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.dependencies.map(({ dep, material }) => {
                        const st = MATERIAL_STATE[material.state];
                        const eff = effectiveDisruptionDays(dep, material.material);
                        return (
                          <TableRow key={dep.id}>
                            <TableCell>
                              <p className="font-medium">{material.material.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {dep.is_blocking ? "Wajib" : "Tidak wajib"} · {material.material.alternative_suppliers} pemasok alternatif
                              </p>
                            </TableCell>
                            <TableCell>
                              <StatusBadge label={st.label} tone={st.tone} />
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {eff} hari
                              {eff !== dep.est_disruption_days && (
                                <p className="text-muted-foreground">({dep.est_disruption_days} tanpa alternatif)</p>
                              )}
                            </TableCell>
                            <TableCell className="tabular text-right text-xs">{formatToken(BigInt(Math.round(Number(dep.est_financial_exposure) * 1e6)) * 10n ** 12n)}</TableCell>
                            {canEdit && production.data && (
                              <TableCell className="text-right">
                                <DependencyDialog dependency={dep} materials={production.data.materials} products={production.data.products} />
                                <DeleteButton type="dependency" id={dep.id} label="dependensi" />
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Dashboard eksposur per material</CardTitle>
              <CardDescription>
                Nilai PO belum terkirim dan bagian terproteksi berasal dari kontrak (terverifikasi onchain); dampak produksi adalah
                estimasi internal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Kritikalitas</TableHead>
                    <TableHead>Status pasokan</TableHead>
                    <TableHead className="text-right">Belum terkirim (onchain)</TableHead>
                    <TableHead className="w-44">Terproteksi</TableHead>
                    <TableHead className="text-right">Eksposur produksi (estimasi)</TableHead>
                    {canEdit && <TableHead className="w-16" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {risk.materials.map((m) => {
                    const st = MATERIAL_STATE[m.state];
                    const outstanding = m.right ? undeliveredValue(m.right, m.right.deliveredQuantity) : 0n;
                    const protection = m.right ? snap?.protections.find((p) => p.id === m.right!.protectionId) : undefined;
                    const covered = protection ? (protection.lockedAmount < outstanding ? protection.lockedAmount : outstanding) : 0n;
                    const prodExposure = (production.data?.dependencies ?? [])
                      .filter((d) => d.material_id === m.material.id && st.disrupting && d.is_blocking)
                      .reduce((s, d) => s + Number(d.est_financial_exposure), 0);
                    const crit = CRITICALITY[m.material.criticality];
                    return (
                      <TableRow key={m.material.id}>
                        <TableCell>
                          <p className="font-medium">{m.material.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.material.code}
                            {m.right && (
                              <>
                                {" · "}
                                <Link href={`/supply/${m.right.id}`} className="text-teal-700 hover:underline">
                                  SR #{m.right.id}
                                </Link>
                              </>
                            )}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge label={crit.label} tone={crit.tone} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge label={st.label} tone={st.tone} />
                        </TableCell>
                        <TableCell className="tabular text-right">{m.right ? formatToken(outstanding) : "-"}</TableCell>
                        <TableCell>
                          {m.right ? (
                            <>
                              <Meter value={outstanding > 0n ? Number((covered * 1000n) / outstanding) / 1000 : 0} />
                              <p className="mt-1 text-xs text-muted-foreground">{formatToken(covered)}</p>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Tanpa PO onchain</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {prodExposure ? `${prodExposure.toLocaleString("id-ID")} mETH` : "-"}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <MaterialDialog material={m.material} agreements={agreements.data ?? []} />
                            <DeleteButton type="material" id={m.material.id} label={`material ${m.material.name}`} />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

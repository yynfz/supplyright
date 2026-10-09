import { parseUnits } from "viem";
import type { Tone } from "@/lib/protocol/labels";
import { ClaimStatus, SupplyStatus, type ProtocolSnapshot, type SupplyRight } from "@/lib/protocol/types";
import { undeliveredValue } from "@/lib/protocol/snapshot";
import type { Criticality, Dependency, Material, Product, ProductionMap } from "@/lib/offchain-types";

/**
 * Supply-risk & production-impact logic. Runs OFFCHAIN in the application: production formulas and
 * exposure estimates are private planning data and are never written onchain. Outputs are ESTIMATES.
 */

export type MaterialState =
  | "ARRIVED"
  | "ON_TRACK"
  | "AT_RISK"
  | "REPORTED_DELAY"
  | "DELAYED"
  | "DEFAULT_ASSESSMENT"
  | "VERIFIED_DEFAULT"
  | "UNLINKED";

export const MATERIAL_STATE: Record<MaterialState, { label: string; tone: Tone; disrupting: boolean }> = {
  ARRIVED: { label: "Tersedia", tone: "success", disrupting: false },
  ON_TRACK: { label: "Sesuai jadwal", tone: "teal", disrupting: false },
  AT_RISK: { label: "Mendekati tenggat", tone: "warning", disrupting: false },
  REPORTED_DELAY: { label: "Keterlambatan dilaporkan", tone: "danger", disrupting: true },
  DELAYED: { label: "Terlambat (lewat tenggat)", tone: "danger", disrupting: true },
  DEFAULT_ASSESSMENT: { label: "Asesmen default", tone: "danger", disrupting: true },
  VERIFIED_DEFAULT: { label: "Default terverifikasi", tone: "danger", disrupting: true },
  UNLINKED: { label: "Belum terhubung PO", tone: "neutral", disrupting: false },
};

export const CRITICALITY: Record<Criticality, { label: string; tone: Tone; rank: number }> = {
  CRITICAL: { label: "Kritis", tone: "danger", rank: 3 },
  HIGH: { label: "Tinggi", tone: "warning", rank: 2 },
  MEDIUM: { label: "Sedang", tone: "info", rank: 1 },
  LOW: { label: "Rendah", tone: "neutral", rank: 0 },
};

const AT_RISK_WINDOW = 7 * 86_400;

export function isOpenRight(r: SupplyRight) {
  return r.status !== SupplyStatus.Fulfilled && r.status !== SupplyStatus.Closed;
}

export function rightForMaterial(m: Material, snapshot?: ProtocolSnapshot) {
  if (!snapshot || !m.po_hash) return undefined;
  return snapshot.supplyRights.find((r) => r.poRefHash.toLowerCase() === m.po_hash!.toLowerCase());
}

export function materialState(m: Material, right: SupplyRight | undefined, now: number): MaterialState {
  if (right) {
    const fullyDelivered = right.deliveredQuantity >= right.orderedQuantity;
    if (fullyDelivered || right.status === SupplyStatus.Fulfilled) return "ARRIVED";
    if (right.status === SupplyStatus.Defaulted || right.status === SupplyStatus.Closed) return "VERIFIED_DEFAULT";
    if (right.status === SupplyStatus.UnderAssessment) return "DEFAULT_ASSESSMENT";
    if (now > right.deliveryDeadline) return "DELAYED";
    if (m.reported_status === "REPORTED_DELAY") return "REPORTED_DELAY";
    if (right.deliveryDeadline - now < AT_RISK_WINDOW) return "AT_RISK";
    return "ON_TRACK";
  }
  if (m.reported_status === "ARRIVED") return "ARRIVED";
  if (m.reported_status === "REPORTED_DELAY") return "REPORTED_DELAY";
  if (m.reported_status === "ON_TRACK") return "ON_TRACK";
  return "UNLINKED";
}

/** Disruption after mitigation: an alternative supplier caps the outage at its lead time. */
export function effectiveDisruptionDays(dep: Dependency, m: Material) {
  if (m.alternative_suppliers > 0 && m.alternative_lead_days !== null && m.alternative_lead_days !== undefined) {
    return Math.min(dep.est_disruption_days, m.alternative_lead_days);
  }
  return dep.est_disruption_days;
}

const toWei = (decimal: string | number) => parseUnits(String(decimal || "0"), 18);

export type MaterialRisk = {
  material: Material;
  right?: SupplyRight;
  state: MaterialState;
  products: Product[];
};

export type ProductRisk = {
  product: Product;
  level: "DISRUPTED" | "WATCH" | "NORMAL";
  disruptingMaterials: MaterialRisk[];
  watchMaterials: MaterialRisk[];
  /** Materials that already arrived but cannot be used because another blocking input is missing. */
  strandedMaterials: MaterialRisk[];
  estDisruptionDays: number;
  estExposure: bigint;
  dependencies: { dep: Dependency; material: MaterialRisk }[];
};

export type ProductionRisk = {
  materials: MaterialRisk[];
  products: ProductRisk[];
  criticalAtRisk: MaterialRisk[];
  affectedDependencies: number;
  totalEstExposure: bigint;
};

export function computeProductionRisk(map: ProductionMap | undefined, snapshot: ProtocolSnapshot | undefined, now: number): ProductionRisk {
  const materials: MaterialRisk[] = (map?.materials ?? []).map((m) => {
    const right = rightForMaterial(m, snapshot);
    const productIds = new Set((map?.dependencies ?? []).filter((d) => d.material_id === m.id).map((d) => d.product_id));
    return {
      material: m,
      right,
      state: materialState(m, right, now),
      products: (map?.products ?? []).filter((p) => productIds.has(p.id)),
    };
  });
  const byId = new Map(materials.map((m) => [m.material.id, m]));

  const products: ProductRisk[] = (map?.products ?? []).map((product) => {
    const deps = (map?.dependencies ?? [])
      .filter((d) => d.product_id === product.id)
      .map((dep) => ({ dep, material: byId.get(dep.material_id)! }))
      .filter((x) => x.material);
    const disrupting = deps.filter((x) => x.dep.is_blocking && MATERIAL_STATE[x.material.state].disrupting);
    const watch = deps.filter((x) => x.material.state === "AT_RISK");
    const level = disrupting.length ? "DISRUPTED" : watch.length ? "WATCH" : "NORMAL";
    const stranded = level === "DISRUPTED" ? deps.filter((x) => x.material.state === "ARRIVED").map((x) => x.material) : [];
    const estDisruptionDays = disrupting.reduce((max, x) => Math.max(max, effectiveDisruptionDays(x.dep, x.material.material)), 0);
    const estExposure = disrupting.reduce((sum, x) => sum + toWei(x.dep.est_financial_exposure), 0n);
    return {
      product,
      level,
      disruptingMaterials: disrupting.map((x) => x.material),
      watchMaterials: watch.map((x) => x.material),
      strandedMaterials: stranded,
      estDisruptionDays,
      estExposure,
      dependencies: deps,
    };
  });

  const criticalAtRisk = materials.filter(
    (m) => (m.material.criticality === "CRITICAL" || m.material.criticality === "HIGH") && MATERIAL_STATE[m.state].disrupting,
  );
  const affectedDependencies = products.reduce((n, p) => n + p.disruptingMaterials.length, 0);
  const totalEstExposure = products.reduce((s, p) => s + p.estExposure, 0n);
  return { materials, products, criticalAtRisk, affectedDependencies, totalEstExposure };
}

/** Onchain-derived financial KPIs (verifiable; no estimates). */
export function computeSupplyKpis(snapshot: ProtocolSnapshot | undefined) {
  const empty = {
    activeCommitments: 0,
    outstandingValue: 0n,
    delayed: [] as SupplyRight[],
    protectedExposure: 0n,
    unprotectedExposure: 0n,
    pendingClaims: 0,
    compensationPaid: 0n,
    perRight: [] as { right: SupplyRight; outstanding: bigint; protectedAmount: bigint }[],
  };
  if (!snapshot) return empty;
  const now = snapshot.blockTimestamp;
  const open = snapshot.supplyRights.filter(isOpenRight);
  const perRight = open.map((right) => {
    const outstanding = undeliveredValue(right, right.deliveredQuantity);
    const protection = snapshot.protections.find((p) => p.id === right.protectionId);
    const remaining = protection ? protection.lockedAmount : 0n;
    const protectedAmount = remaining < outstanding ? remaining : outstanding;
    return { right, outstanding, protectedAmount };
  });
  const outstandingValue = perRight.reduce((s, x) => s + x.outstanding, 0n);
  const protectedExposure = perRight.reduce((s, x) => s + x.protectedAmount, 0n);
  return {
    activeCommitments: open.length,
    outstandingValue,
    delayed: open.filter((r) => now > r.deliveryDeadline && r.deliveredQuantity < r.orderedQuantity),
    protectedExposure,
    unprotectedExposure: outstandingValue - protectedExposure,
    pendingClaims: snapshot.claims.filter((c) =>
      [ClaimStatus.Submitted, ClaimStatus.Approved, ClaimStatus.Disputed].includes(c.status),
    ).length,
    compensationPaid: snapshot.claims
      .filter((c) => c.status === ClaimStatus.Settled)
      .reduce((s, c) => s + c.payoutAmount, 0n),
    perRight,
  };
}

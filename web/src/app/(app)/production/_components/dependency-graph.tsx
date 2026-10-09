"use client";

import { StatusBadge } from "@/components/status-badge";
import { CRITICALITY, MATERIAL_STATE, type ProductionRisk } from "@/lib/risk";
import { cn } from "@/lib/utils";

const ROW = 76; // card height + gap, keeps SVG connectors aligned with the cards
const CARD = 64;

/**
 * Material → Product map. Connector colour reflects the material's supply state:
 * red = disrupting a blocking input, amber = approaching deadline, grey = fine. Dashed = non-blocking.
 */
export function DependencyGraph({ risk }: { risk: ProductionRisk }) {
  const materials = [...risk.materials].sort(
    (a, b) => CRITICALITY[b.material.criticality].rank - CRITICALITY[a.material.criticality].rank,
  );
  const products = risk.products;
  const rows = Math.max(materials.length, products.length, 1);
  const height = rows * ROW;
  const mIndex = new Map(materials.map((m, i) => [m.material.id, i]));
  const pIndex = new Map(products.map((p, i) => [p.product.id, i]));
  const y = (i: number) => i * ROW + CARD / 2;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
      <div className="space-y-3">
        {materials.map((m) => {
          const st = MATERIAL_STATE[m.state];
          return (
            <div
              key={m.material.id}
              style={{ height: CARD }}
              className={cn(
                "flex flex-col justify-center rounded-md border bg-white px-3",
                st.disrupting && "border-rose-300 bg-rose-50/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{m.material.name}</p>
                <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
                  {CRITICALITY[m.material.criticality].label}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge label={st.label} tone={st.tone} />
                {m.right && <span className="text-[11px] text-muted-foreground">SR #{m.right.id}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-full w-full" style={{ height }} aria-hidden>
        {products.flatMap((p) =>
          p.dependencies.map(({ dep, material }) => {
            const from = mIndex.get(material.material.id);
            const to = pIndex.get(p.product.id);
            if (from === undefined || to === undefined) return null;
            const st = MATERIAL_STATE[material.state];
            const color = st.disrupting && dep.is_blocking ? "#e11d48" : material.state === "AT_RISK" ? "#f59e0b" : "#94a3b8";
            return (
              <path
                key={dep.id}
                d={`M0 ${y(from)} C 50 ${y(from)}, 50 ${y(to)}, 100 ${y(to)}`}
                fill="none"
                stroke={color}
                strokeWidth={st.disrupting ? 2.5 : 1.5}
                strokeDasharray={dep.is_blocking ? undefined : "4 3"}
                vectorEffect="non-scaling-stroke"
              />
            );
          }),
        )}
      </svg>

      <div className="space-y-3">
        {products.map((p) => (
          <div
            key={p.product.id}
            style={{ height: CARD }}
            className={cn(
              "flex flex-col justify-center rounded-md border bg-white px-3",
              p.level === "DISRUPTED" && "border-rose-300 bg-rose-50/60",
              p.level === "WATCH" && "border-amber-300 bg-amber-50/60",
            )}
          >
            <p className="truncate text-sm font-medium text-navy">{p.product.name}</p>
            <div className="mt-1">
              <StatusBadge
                label={p.level === "DISRUPTED" ? "Berisiko terhenti" : p.level === "WATCH" ? "Waspada" : "Normal"}
                tone={p.level === "DISRUPTED" ? "danger" : p.level === "WATCH" ? "warning" : "success"}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

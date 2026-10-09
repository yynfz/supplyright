"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { TxLink } from "@/components/onchain";
import { EmptyState } from "@/components/page";
import { useEntityLookup, useProtocolEvents, useProtocolSnapshot } from "@/hooks/use-protocol";
import { describeEvent } from "@/lib/protocol/describe";
import { relatedSupplyRightId, type ProtocolEvent } from "@/lib/protocol/events";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/protocol/labels";

const DOT: Record<Tone, string> = {
  neutral: "bg-slate-300",
  info: "bg-sky-500",
  teal: "bg-teal-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  navy: "bg-navy",
};

/** Noise that duplicates more meaningful events in the same transaction. */
const HIDDEN = new Set(["Transfer", "ProtectionClaimStatusChanged", "ClaimOpenedOnProtection", "ClaimClosedOnProtection", "Approval"]);

/**
 * Audit timeline built purely from onchain events (source of truth). Optionally filtered to a supply right
 * or a predicate, newest first.
 */
export function AuditTimeline({
  supplyRightId,
  filter,
  limit = 50,
  importantOnly,
  showAll,
  className,
}: {
  supplyRightId?: number;
  filter?: (e: ProtocolEvent) => boolean;
  limit?: number;
  importantOnly?: boolean;
  showAll?: boolean;
  className?: string;
}) {
  const events = useProtocolEvents();
  const snapshot = useProtocolSnapshot();
  const lookup = useEntityLookup(snapshot.data);

  const items = useMemo(() => {
    const list = (events.data ?? []).filter((e) => {
      if (!showAll && HIDDEN.has(e.name)) return false;
      if (supplyRightId !== undefined && relatedSupplyRightId(e, lookup) !== supplyRightId) return false;
      if (filter && !filter(e)) return false;
      if (importantOnly && !describeEvent(e).important) return false;
      return true;
    });
    return list.slice(-limit).reverse();
  }, [events.data, supplyRightId, filter, importantOnly, limit, lookup, showAll]);

  if (events.isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Membaca event onchain…
      </div>
    );
  }
  if (events.error) {
    return <p className="text-sm text-rose-700">Gagal membaca event: {(events.error as Error).message}</p>;
  }
  if (!items.length) return <EmptyState title="Belum ada aktivitas onchain" />;

  return (
    <ol className={cn("relative space-y-4 border-l border-slate-200 pl-5", className)}>
      {items.map((e) => {
        const d = describeEvent(e);
        return (
          <li key={e.id} className="relative">
            <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white", DOT[d.tone])} />
            <p className={cn("text-sm", d.important ? "font-medium text-navy" : "text-foreground")}>{d.title}</p>
            {d.detail && <p className="text-xs text-muted-foreground">{d.detail}</p>}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span>{formatDateTime(e.timestamp)}</span>
              <span>· blok {e.blockNumber.toString()}</span>
              <span>·</span>
              <TxLink hash={e.transactionHash} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

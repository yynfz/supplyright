"use client";

import { CheckCircle2, CircleDashed, Loader2, PenLine, Radio, XCircle } from "lucide-react";
import type { TxState } from "@/hooks/use-protocol-tx";
import { TxLink } from "@/components/onchain";
import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { cn } from "@/lib/utils";

const STEPS = [
  { phase: "simulating", label: "Simulasi", icon: CircleDashed },
  { phase: "signing", label: "Tanda tangan", icon: PenLine },
  { phase: "pending", label: "Menunggu blok", icon: Radio },
  { phase: "confirmed", label: "Terkonfirmasi", icon: CheckCircle2 },
] as const;

const ORDER = { idle: -1, simulating: 0, signing: 1, pending: 2, confirmed: 3, failed: -1 } as const;

/** Inline progress for the most recent transaction of a form. Shows the real hash and outcome. */
export function TxStatus({ state, className }: { state: TxState; className?: string }) {
  if (state.phase === "idle") return null;
  const current = ORDER[state.phase];
  return (
    <div className={cn("rounded-md border bg-muted/30 p-3 text-xs", className)} aria-live="polite">
      {state.label && <p className="mb-2 font-medium text-navy">{state.label}</p>}
      {state.phase === "failed" ? (
        <div className="flex items-start gap-2 text-rose-700">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{state.error?.userRejected ? "Dibatalkan" : "Gagal"}</p>
            <p className="text-rose-700/90">{state.error?.message}</p>
          </div>
        </div>
      ) : (
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {STEPS.map((s, i) => {
            const done = current > i || state.phase === "confirmed";
            const active = current === i && state.phase !== "confirmed";
            const Icon = active ? Loader2 : s.icon;
            return (
              <li
                key={s.phase}
                className={cn(
                  "flex items-center gap-1.5",
                  done ? "text-teal-700" : active ? "text-navy" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("size-3.5", active && "animate-spin")} />
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
      {state.hash && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-muted-foreground">
          Tx: <TxLink hash={state.hash} chainId={state.chainId} />
          {state.chainId === SEPOLIA_CHAIN_ID && <span>(Sepolia Etherscan)</span>}
          {state.blockNumber !== undefined && <span>· blok {state.blockNumber.toString()}</span>}
        </p>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/protocol/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
  navy: "bg-navy text-white ring-navy",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-slate-400",
  info: "bg-sky-500",
  teal: "bg-teal-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  navy: "bg-white",
};

export function StatusBadge({
  label,
  tone = "neutral",
  title,
  className,
}: {
  label: string;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {label}
    </span>
  );
}

export function toneText(tone: Tone) {
  return {
    neutral: "text-slate-600",
    info: "text-sky-700",
    teal: "text-teal-700",
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-rose-700",
    navy: "text-navy",
  }[tone];
}

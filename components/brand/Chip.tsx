import { cn } from "@/lib/cn";

export type ChipTone = "neutral" | "brand" | "ok" | "warn" | "danger" | "advise";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "bg-hairline-soft text-ink-soft",
  brand: "bg-brand-soft text-brand-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn-ink",
  danger: "bg-danger-soft text-danger",
  // matches the inline advise palette in shared.jsx — warm gold tone
  advise: "bg-[oklch(95%_0.05_80)] text-[oklch(45%_0.13_65)]",
};

interface ChipProps {
  tone?: ChipTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Chip({ tone = "neutral", dot = true, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-[11px] font-semibold tracking-wide",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className="block size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* Status-named convenience: matches STATUS_META in shared.jsx */
export type DocStatus =
  | "received"
  | "pending"
  | "overdue"
  | "stale"
  | "incomplete"
  | "na";

const STATUS_TO_CHIP: Record<DocStatus, { tone: ChipTone; label: string }> = {
  received: { tone: "ok", label: "Received" },
  pending: { tone: "warn", label: "Pending" },
  overdue: { tone: "danger", label: "Overdue" },
  stale: { tone: "advise", label: "Needs update" },
  incomplete: { tone: "advise", label: "Incomplete" },
  na: { tone: "neutral", label: "N/A" },
};

export function StatusChip({ status }: { status: DocStatus }) {
  const meta = STATUS_TO_CHIP[status];
  return <Chip tone={meta.tone}>{meta.label}</Chip>;
}

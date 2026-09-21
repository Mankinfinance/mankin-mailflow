import Link from "next/link";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "ok" | "warn";

const TONE_DELTA: Record<Tone, string> = {
  neutral: "text-ink-mute",
  brand: "text-brand",
  ok: "text-ok",
  warn: "text-warn-ink",
};

interface KpiTileProps {
  label: string;
  value: string;
  delta?: string;
  tone?: Tone;
  /** When provided the tile becomes a link. */
  href?: string;
  /** Highlight the tile as the active filter. */
  active?: boolean;
}

export function KpiTile({ label, value, delta, tone = "neutral", href, active }: KpiTileProps) {
  const baseClass = cn(
    "rounded-[10px] border px-4 py-3.5",
    active
      ? "border-brand bg-brand/5 ring-1 ring-brand/30"
      : "border-hairline bg-surface",
    href && "transition-colors hover:border-brand/40 hover:bg-paper-warm/50",
  );
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
        {label}
      </div>
      <div
        className="mt-1 text-[26px] font-medium"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {delta && (
        <div className={cn("mt-0.5 text-[11.5px] font-semibold", TONE_DELTA[tone])}>
          {delta}
        </div>
      )}
    </>
  );
  if (href) {
    return <Link href={href} className={baseClass}>{inner}</Link>;
  }
  return <div className={baseClass}>{inner}</div>;
}

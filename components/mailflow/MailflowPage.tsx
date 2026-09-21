import { cn } from "@/lib/cn";

/**
 * The page furniture every Mailflow screen shares: the content column's
 * padding and rhythm, section headers with their eyebrow labels, and the
 * card shell.
 *
 * Kept here rather than repeated per screen so the handoff's spacing
 * rhythm (22px between dashboard sections, 14–16px between sibling cards,
 * 12–14px inside one) holds by construction.
 */

export function MailflowContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 overflow-y-auto px-6 pb-[30px] pt-[22px]", className)}>
      {children}
    </div>
  );
}

export function PageTitle({
  title,
  context,
  actions,
}: {
  title: string;
  /** The 11px muted line beneath — date, counts, provenance. */
  context?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-[22px] flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1
          className="text-[20px] leading-tight text-brand-deep"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500, letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
        {context && <p className="mt-1 text-[11px] text-ink-mute">{context}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 10.5px bold uppercase eyebrow — the module's section label. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[10.5px] font-bold uppercase text-ink-faint",
        className,
      )}
      style={{ letterSpacing: "0.12em" }}
    >
      {children}
    </div>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-[10px] border border-hairline bg-surface",
        padded && "px-3.5 py-3.5",
        className,
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </section>
  );
}

/**
 * Stat tiles in a 1px-gap grid where the gap itself is the divider —
 * a hairline background showing through between white tiles, which reads
 * cleaner at this density than four bordered boxes.
 */
export function StatGrid({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-px overflow-hidden rounded-lg"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        backgroundColor: "var(--color-hairline-softer)",
      }}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  tone,
  note,
}: {
  label: string;
  value: string;
  /** Rendered smaller and muted beside the number, e.g. "%". */
  suffix?: string;
  /** Series colour for a number that names a charted series. */
  tone?: string;
  note?: string;
}) {
  return (
    <div className="bg-surface px-3.5 py-[11px]">
      <Eyebrow>{label}</Eyebrow>
      <div
        className="mt-1 text-[24px] font-semibold leading-none tabular-nums"
        style={{ color: tone ?? "var(--color-ink)" }}
      >
        {value}
        {suffix && (
          <span className="ml-0.5 text-[15px] font-normal text-ink-mute">
            {suffix}
          </span>
        )}
      </div>
      {note && <div className="mt-1.5 text-[10.5px] text-ink-mute">{note}</div>}
    </div>
  );
}

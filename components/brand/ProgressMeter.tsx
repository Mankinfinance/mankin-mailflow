interface ProgressMeterProps {
  received: number;
  total: number;
  label?: string;
}

export function ProgressMeter({ received, total, label = "Documents received" }: ProgressMeterProps) {
  const pct = total > 0 ? Math.round((received / total) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
          {label}
        </div>
        <div className="text-[22px] font-medium text-ink serif" style={{ fontFamily: "var(--font-display)" }}>
          {received}
          <span className="text-ink-faint">/{total}</span>
          <span className="ml-2 text-[12px] font-semibold text-ink-mute" style={{ fontFamily: "var(--font-sans)" }}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="relative h-2 overflow-hidden rounded-lg bg-hairline-soft">
        <div
          className="absolute inset-y-0 left-0 rounded-lg transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--color-brand) 0%, var(--color-brand-deep) 100%)",
          }}
        />
      </div>
    </div>
  );
}

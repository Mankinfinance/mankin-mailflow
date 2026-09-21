interface SectionLabelProps {
  hint?: string;
  children: React.ReactNode;
}

export function SectionLabel({ children, hint }: SectionLabelProps) {
  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        {children}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-faint">{hint}</div>}
    </div>
  );
}

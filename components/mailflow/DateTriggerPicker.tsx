"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { setDateTriggerAction } from "@/app/(mailflow)/marketing/automations/actions";

/**
 * Which date starts this sequence, and how far ahead of it (or after).
 * Sits above the canvas like the form and tag pickers, and locks while
 * the sequence is live for the same reason.
 */
export function DateTriggerPicker({
  automationId,
  current,
  fields,
  locked,
}: {
  automationId: string;
  current: { fieldId: string; days: number; when: "before" | "after" };
  fields: Array<{ id: string; label: string }>;
  locked: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(current);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, start] = React.useTransition();

  function save(next: typeof value) {
    setValue(next);
    setSaved(false);
    setError(null);
    if (!next.fieldId) return;
    start(async () => {
      const r = await setDateTriggerAction(automationId, next);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  const CONTROL =
    "h-[32px] rounded-md border border-hairline bg-surface px-2 text-[12.5px] text-ink disabled:opacity-60";

  return (
    <div
      className="mb-3.5 rounded-[10px] border px-3.5 py-3"
      style={{ backgroundColor: "#f6f8ff", borderColor: "#cfd7f5" }}
    >
      <div className="flex items-center gap-1.5">
        <CalendarClock size={13} strokeWidth={1.7} style={{ color: "#4151a8" }} />
        <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "#4151a8" }}>
          Starts from a date
        </span>
      </div>
      <p className="mt-1 max-w-[600px] text-[11.5px] leading-relaxed text-ink-mute">
        Set each client&apos;s date under Subscribers (open someone, then Key dates). Each
        person goes through this once. Anyone whose day passed more than two weeks before
        it&apos;s turned on is left out rather than written to late.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          aria-label="Days"
          min={0}
          max={730}
          value={value.days}
          disabled={locked || pending}
          onChange={(e) => setValue({ ...value, days: Math.max(0, Math.min(730, Number(e.target.value) || 0)) })}
          onBlur={() => save(value)}
          className={`${CONTROL} w-[76px]`}
        />
        <span className="text-[12.5px] text-ink">days</span>
        <select
          aria-label="Before or after"
          value={value.when}
          disabled={locked || pending}
          onChange={(e) => save({ ...value, when: e.target.value as "before" | "after" })}
          className={CONTROL}
        >
          <option value="before">before</option>
          <option value="after">after</option>
        </select>
        <select
          aria-label="Which date"
          value={value.fieldId}
          disabled={locked || pending}
          onChange={(e) => save({ ...value, fieldId: e.target.value })}
          className={`${CONTROL} min-w-[220px]`}
        >
          <option value="">Choose a date…</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {saved && !pending && (
          <span className="text-[11.5px] font-semibold" style={{ color: "#2f6f4a" }}>
            Set.
          </span>
        )}
      </div>
      {locked && (
        <p className="mt-1.5 text-[11px] text-ink-mute">Pause the sequence to change this.</p>
      )}
      {error && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}
    </div>
  );
}

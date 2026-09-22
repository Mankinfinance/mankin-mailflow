"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Tag as TagIcon } from "lucide-react";
import { setTriggerTargetAction } from "@/app/(mailflow)/marketing/automations/actions";

/**
 * Which form, or which tag, starts this sequence.
 *
 * Every other template arrives fully wired, because the loan book
 * already answers its trigger. These two cannot: a form enquiry or a
 * label is a thing the firm creates, so the template ships with the
 * choice blank and the sequence refuses to go live until it is made.
 * This is where it gets made.
 *
 * Sits above the canvas rather than inside it because it is a decision
 * about the whole sequence, not about a step in it.
 */

export interface TriggerTargetPickerProps {
  automationId: string;
  kind: "form-submission" | "tag-added";
  /** Currently chosen form id or tag; empty when still unset. */
  current: string;
  /** Live forms to choose from, for kind "form-submission". */
  forms: Array<{ id: string; name: string; submissions: number }>;
  /** Tags in use, for kind "tag-added". */
  tags: Array<{ tag: string; count: number }>;
  /** Live sequences cannot have their trigger swapped underneath them. */
  locked: boolean;
}

export function TriggerTargetPicker({
  automationId,
  kind,
  current,
  forms,
  tags,
  locked,
}: TriggerTargetPickerProps) {
  const router = useRouter();
  const [value, setValue] = React.useState(current);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const isForm = kind === "form-submission";
  const options = isForm
    ? forms.map((f) => ({
        value: f.id,
        label: f.name,
        hint: `${f.submissions} ${f.submissions === 1 ? "enquiry" : "enquiries"} so far`,
      }))
    : tags.map((t) => ({
        value: t.tag,
        label: t.tag,
        hint: `${t.count} ${t.count === 1 ? "contact" : "contacts"}`,
      }));

  function save(next: string) {
    setValue(next);
    setError(null);
    setSaved(false);
    if (!next) return;
    startTransition(async () => {
      const result = await setTriggerTargetAction(automationId, next);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error ?? "That didn't work.");
        setValue(current);
      }
    });
  }

  const Icon = isForm ? ClipboardList : TagIcon;

  return (
    <div
      className="mb-3.5 rounded-[10px] border px-3.5 py-3"
      style={{ backgroundColor: "#f6f8ff", borderColor: "#cfd7f5" }}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={13} strokeWidth={1.7} style={{ color: "#4151a8" }} />
        <span
          className="text-[10px] font-bold uppercase"
          style={{ letterSpacing: "0.12em", color: "#4151a8" }}
        >
          {isForm ? "Starts from a form" : "Starts from a tag"}
        </span>
      </div>

      <p className="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-ink-mute">
        {isForm
          ? "Everyone who enquires through this form enters the sequence once. Choosing it is the last step before it can run."
          : "Anyone you give this tag enters the sequence once. Tagging a client is then the whole of the work."}
      </p>

      {options.length === 0 ? (
        <p className="mt-2 text-[12px] font-semibold" style={{ color: "#8a4b48" }}>
          {isForm
            ? "No forms yet — build one under Forms first, then come back."
            : "No tags in use yet — tag a contact under Subscribers first."}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={value}
            disabled={locked || pending}
            onChange={(e) => save(e.target.value)}
            className="h-[32px] min-w-[240px] rounded-md border border-hairline bg-surface px-2 text-[12.5px] text-ink disabled:opacity-60"
          >
            <option value="">
              {isForm ? "Choose a form…" : "Choose a tag…"}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.hint}
              </option>
            ))}
          </select>

          {saved && !pending && (
            <span className="text-[11.5px] font-semibold" style={{ color: "#2f6f4a" }}>
              Set.
            </span>
          )}
        </div>
      )}

      {locked && (
        <p className="mt-1.5 text-[11px] text-ink-mute">
          Pause the sequence to change this — swapping what starts a running
          automation would leave whoever is partway along it enrolled by a rule
          that no longer exists.
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}
    </div>
  );
}

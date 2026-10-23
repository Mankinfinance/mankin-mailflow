"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { AutomationNode } from "@/lib/automations/types";
import { editableFields, type StepPatch } from "@/lib/automations/edit";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { checkContent } from "@/lib/campaigns/spam-check";
import { previewEmail } from "@/lib/campaigns/preview";
import type { SignatureSettings } from "@/lib/mailflow/settings";
import { updateAutomationStepAction } from "@/app/(mailflow)/marketing/automations/actions";
import { AutomationCanvas, CanvasSelection, type AutomationCanvasProps } from "./AutomationCanvas";

/**
 * The sequence canvas with a panel for changing one step. Click a card
 * and its words or timing open beside it; the shape of the sequence is
 * not editable here, on purpose (see lib/automations/edit.ts).
 */
export function AutomationEditor({
  automationId,
  live,
  fromBrokerId,
  fromName,
  signature,
  postalAddress,
  canvas,
}: {
  automationId: string;
  live: boolean;
  fromBrokerId: string;
  fromName: string;
  signature?: SignatureSettings;
  postalAddress?: string;
  canvas: AutomationCanvasProps;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const node = canvas.flow.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <CanvasSelection.Provider value={{ selectedId, onSelect: setSelectedId }}>
          <AutomationCanvas {...canvas} />
        </CanvasSelection.Provider>
        {!node && (
          <p className="mt-2 text-center text-[11.5px] text-ink-mute">
            Click a step to change its email or timing.
          </p>
        )}
      </div>
      {node && (
        <StepPanel
          key={node.id}
          automationId={automationId}
          node={node}
          live={live}
          fromBrokerId={fromBrokerId}
          fromName={fromName}
          signature={signature}
          postalAddress={postalAddress}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

const KIND_LABEL: Record<AutomationNode["kind"], string> = {
  send: "Email",
  survey: "Survey invitation",
  delay: "Wait",
  condition: "Condition",
  split: "Split",
  exit: "Exit",
};

function StepPanel({
  automationId,
  node,
  live,
  fromBrokerId,
  fromName,
  signature,
  postalAddress,
  onClose,
}: {
  automationId: string;
  node: AutomationNode;
  live: boolean;
  fromBrokerId: string;
  fromName: string;
  signature?: SignatureSettings;
  postalAddress?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fields = editableFields(node);
  const isEmail = node.kind === "send" || node.kind === "survey";
  const [draft, setDraft] = React.useState<StepPatch>({
    label: node.label ?? "",
    subject: node.subject ?? "",
    body: node.body ?? "",
    days: node.days,
    withinDays: node.withinDays,
    splitPercent: node.splitPercent ?? 50,
    note: node.note ?? "",
  });
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: StepPatch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setError(null);
  };

  function save() {
    const patch: StepPatch = {};
    for (const f of fields) (patch as Record<string, unknown>)[f] = draft[f];
    startTransition(async () => {
      const r = await updateAutomationStepAction(automationId, node.id, patch);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  function insertField(field: string) {
    setMode("write");
    const token = `{{${field}}}`;
    const el = bodyRef.current;
    const body = draft.body ?? "";
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    set({ body: body.slice(0, start) + token + body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const spam = isEmail
    ? checkContent({ subject: draft.subject ?? "", body: draft.body ?? "" }).filter(
        (i) => i.severity === "warn",
      )
    : [];
  const mergeFields = node.kind === "survey" ? [...MERGE_FIELDS, "survey_link"] : MERGE_FIELDS;

  return (
    <aside
      aria-label="Edit step"
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-surface xl:sticky xl:inset-auto xl:top-3.5 xl:z-auto xl:max-h-[calc(100vh-110px)] xl:w-[460px] xl:shrink-0 xl:rounded-[10px] xl:border xl:border-hairline"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase text-ink-faint" style={{ letterSpacing: "0.12em" }}>
            {KIND_LABEL[node.kind]}
          </div>
          <div className="truncate text-[13.5px] font-semibold text-ink">
            {node.label || (isEmail ? node.subject : KIND_LABEL[node.kind])}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saved && !error && <span className="text-[11.5px] text-ok">Saved</span>}
          {fields.length > 0 && (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="mf-quiet h-[30px] rounded-md px-3.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: "#161461" }}
            >
              {pending ? "Saving…" : "Save step"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mf-quiet flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-paper-warm"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="border-b border-hairline bg-danger-soft px-4 py-2 text-[11.5px] text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3.5 px-4 pb-24 pt-4 xl:pb-4">
        {live && (
          <p className="rounded-md bg-paper-warm px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
            This sequence is on. Changes apply from the next time anyone reaches
            this step{node.kind === "delay" || node.kind === "condition" ? ", including people already waiting here" : ""}.
          </p>
        )}

        {fields.includes("label") && (
          <Field label="Step name" hint="Shown on the canvas only">
            <input
              value={draft.label}
              onChange={(e) => set({ label: e.target.value })}
              className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
            />
          </Field>
        )}

        {isEmail && (
          <>
            <Field label="Subject line" hint={`${(draft.subject ?? "").length} characters`}>
              <input
                value={draft.subject}
                onChange={(e) => set({ subject: e.target.value })}
                className="mono h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
              />
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-ink-soft">Body</span>
                <div role="tablist" aria-label="Body view" className="flex rounded-md border border-hairline bg-paper p-0.5">
                  {(["write", "preview"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={
                        "mf-quiet rounded-[5px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors " +
                        (mode === m ? "bg-surface text-brand shadow-sm" : "text-ink-mute hover:text-ink")
                      }
                    >
                      {m === "write" ? "Write" : "Preview"}
                    </button>
                  ))}
                </div>
              </div>
              {mode === "write" ? (
                <textarea
                  ref={bodyRef}
                  value={draft.body}
                  onChange={(e) => set({ body: e.target.value })}
                  rows={14}
                  className="mono w-full resize-y rounded-md border border-hairline px-3 py-2.5 text-[12px] leading-relaxed text-ink"
                  style={{ backgroundColor: "#fffdfa" }}
                />
              ) : (
                <Preview
                  subject={draft.subject ?? ""}
                  body={draft.body ?? ""}
                  brokerId={fromBrokerId}
                  fromName={fromName}
                  signature={signature}
                  postalAddress={postalAddress}
                />
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {mergeFields.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => insertField(f)}
                    className="mono rounded border border-hairline bg-brand-soft px-1.5 py-0.5 text-[10.5px] text-brand hover:bg-paper-warm"
                  >
                    {`{{${f}}}`}
                  </button>
                ))}
              </div>
            </div>
            {spam.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warn bg-warn-soft px-3 py-2 text-[11.5px] text-warn-ink">
                {spam.map((i) => (
                  <li key={i.message}>{i.message}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {fields.includes("days") && (
          <Field label="Wait for" hint="1 to 365 days">
            <DaysInput value={draft.days} onChange={(days) => set({ days })} />
          </Field>
        )}
        {fields.includes("withinDays") && (
          <Field label="Give them up to" hint="Then it takes the No path">
            <DaysInput value={draft.withinDays} onChange={(withinDays) => set({ withinDays })} />
          </Field>
        )}
        {node.kind === "condition" && fields.length === 0 && (
          <p className="text-[12px] text-ink-mute">
            This condition is answered from the contact&apos;s record, so there is no
            timing to change.
          </p>
        )}
        {fields.includes("splitPercent") && (
          <Field label="Share taking the A path" hint={`${100 - (draft.splitPercent ?? 50)}% take B`}>
            <input
              type="number"
              min={1}
              max={99}
              value={draft.splitPercent ?? 50}
              onChange={(e) => set({ splitPercent: Number(e.target.value) })}
              className="h-[34px] w-24 rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
            />
          </Field>
        )}
        {fields.includes("note") && (
          <Field label="Why it ends here" hint="Shown when you hover the Exit">
            <input
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
            />
          </Field>
        )}
      </div>

    </aside>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-ink-soft">{label}</span>
        {hint && <span className="text-[10.5px] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function DaysInput({ value, onChange }: { value?: number; onChange: (n: number) => void }) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[34px] w-24 rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
      />
      <span className="text-[12px] text-ink-mute">{value === 1 ? "day" : "days"}</span>
    </span>
  );
}

function Preview({
  subject,
  body,
  brokerId,
  fromName,
  signature,
  postalAddress,
}: {
  subject: string;
  body: string;
  brokerId: string;
  fromName: string;
  signature?: SignatureSettings;
  postalAddress?: string;
}) {
  const rendered = React.useMemo(
    () => previewEmail({ subject, body, brokerId, signature, postalAddress }),
    [subject, body, brokerId, signature, postalAddress],
  );
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(420);
  return (
    <div className="overflow-hidden rounded-md border border-hairline">
      <div className="border-b border-hairline bg-paper px-3 py-2 text-[11.5px]">
        <div className="truncate"><span className="text-ink-faint">From </span>{fromName}</div>
        <div className="truncate"><span className="text-ink-faint">Subject </span><span className="font-semibold text-ink">{rendered.subject || "(no subject)"}</span></div>
      </div>
      <iframe
        ref={ref}
        title="Email preview"
        sandbox="allow-same-origin"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;background:#fff}</style></head><body>${rendered.html}</body></html>`}
        onLoad={() => {
          const doc = ref.current?.contentDocument;
          if (doc) setHeight(Math.max(220, doc.documentElement.scrollHeight + 8));
        }}
        className="block w-full border-0 bg-white"
        style={{ height }}
      />
      <p className="border-t border-hairline bg-paper px-3 py-1.5 text-[10.5px] text-ink-mute">
        Example client Sarah Chen at Westpac.
      </p>
    </div>
  );
}

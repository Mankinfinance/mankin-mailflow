"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { saveSettingsAction } from "@/app/(mailflow)/marketing/settings/actions";
import {
  MAX_BATCH,
  MIN_BATCH,
  estimateSendWindow,
  type MailflowSettings,
} from "@/lib/mailflow/settings";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * The settings a broker can change without a deploy.
 *
 * Grouped by what they affect rather than by where they are stored, and
 * each one says what happens if it is wrong — these are the settings
 * that reach a customer's inbox, so "postal address" on its own is not
 * enough of a label.
 */

export interface SettingsFormProps {
  initial: MailflowSettings;
  /** Live numbers, so the pace control can say what it means. */
  contactCount: number;
  runsPerDay: number;
  /** Where env vars are still supplying a value the store has not
   *  overridden — shown so the source of a value is never a mystery. */
  fromEnv: { postalAddress: boolean; unsubscribeMailto: boolean };
}

export function SettingsForm({
  initial,
  contactCount,
  runsPerDay,
  fromEnv,
}: SettingsFormProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function patch(next: Partial<MailflowSettings>) {
    setDraft((d) => ({ ...d, ...next }));
    setStatus(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveSettingsAction(draft);
      if (result.ok) {
        setStatus({ tone: "ok", text: "Saved." });
        router.refresh();
      } else {
        setStatus({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="max-w-[640px] space-y-3.5">
      {/* ── Footer ── */}
      <Card>
        <Eyebrow>What every campaign carries</Eyebrow>
        <p className="mb-3.5 mt-1 text-[12px] leading-relaxed text-ink-mute">
          Appended by the sender, not by whoever writes the email, so no
          campaign can go out without it.
        </p>

        <Field
          label="Postal address"
          hint={
            fromEnv.postalAddress
              ? "Currently coming from CAMPAIGN_POSTAL_ADDRESS. Saving here takes over."
              : "Printed under the unsubscribe line. Leave empty and the line is left out — an address nobody can write to is worse than none."
          }
        >
          <input
            value={draft.postalAddress}
            onChange={(e) => patch({ postalAddress: e.target.value })}
            placeholder="Suite 208, Oran Park Podium, 351 Oran Park Drive, Oran Park NSW 2570"
            className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink placeholder:text-ink-faint"
          />
        </Field>

        <Field
          label="Unsubscribe mailbox"
          hint={
            fromEnv.unsubscribeMailto
              ? "Currently coming from CAMPAIGN_UNSUBSCRIBE_MAILTO. Saving here takes over."
              : "Optional, and only worth setting if someone reads it daily. A request that lands in an unread mailbox still counts as made."
          }
        >
          <input
            value={draft.unsubscribeMailto}
            onChange={(e) => patch({ unsubscribeMailto: e.target.value })}
            placeholder="unsubscribe@mankinfinance.com"
            className="mono h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
          />
        </Field>
      </Card>

      {/* ── Tracking ── */}
      <Card>
        <Eyebrow>Tracking</Eyebrow>
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-mute">
          What a new campaign starts with. Changing these leaves existing
          campaigns exactly as they were.
        </p>

        <Toggle
          label="Track opens"
          hint="A 1×1 pixel. Many mail clients now load it on the reader's behalf, so treat opens as a soft signal."
          checked={draft.trackOpensByDefault}
          onChange={(v) => patch({ trackOpensByDefault: v })}
        />
        <Toggle
          label="Track clicks"
          hint="Rewrites links through a redirect. The more reliable of the two, and what the report's link table is built from."
          checked={draft.trackClicksByDefault}
          onChange={(v) => patch({ trackClicksByDefault: v })}
        />
      </Card>

      {/* ── Pace ── */}
      <Card>
        <Eyebrow>Send pace</Eyebrow>
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-mute">
          How many emails go out per scheduled run. Lower is slower and
          gentler on the sending reputation; the ceiling is set well under
          what Exchange allows.
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {[10, 20, 40, 60, 90, 120].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => patch({ batchSize: n })}
              className="mf-quiet rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold transition-colors"
              style={
                draft.batchSize === n
                  ? { backgroundColor: "#161461", borderColor: "#161461", color: "#fff" }
                  : { borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }
              }
            >
              {n}
            </button>
          ))}
        </div>

        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-soft">
          At {draft.batchSize} per run, a campaign to all {contactCount}{" "}
          contacts takes{" "}
          <strong className="font-semibold text-brand">
            {estimateSendWindow(contactCount, draft.batchSize, runsPerDay)}
          </strong>
          .
        </p>
        {runsPerDay < 24 && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
            Based on {runsPerDay} scheduled {runsPerDay === 1 ? "run" : "runs"} a
            day. On the Vercel Hobby plan a cron can only run daily — moving to
            Pro and restoring the hourly schedule is what makes the pace control
            worth using.
          </p>
        )}
        <p className="mt-1 text-[10.5px] text-ink-faint">
          Between {MIN_BATCH} and {MAX_BATCH}.
        </p>
      </Card>

      <div className="flex items-center gap-2.5 pb-4">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="mf-quiet h-[32px] rounded-md px-3.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: "#161461" }}
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {dirty && !status && (
          <span className="text-[11.5px] text-ink-mute">Unsaved changes</span>
        )}
        {status && (
          <span
            className="text-[11.5px] font-semibold"
            style={{ color: status.tone === "ok" ? "#2b6e4f" : "#8a4b48" }}
          >
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3.5 block last:mb-0">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink">
        {label}
      </span>
      {children}
      <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">
        {hint}
      </span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5 last:mb-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="mf-quiet relative mt-0.5 h-[17px] w-[30px] shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? "#161461" : "#d8dbe2" }}
      >
        <span
          className="mf-quiet absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all"
          style={{ left: checked ? 15 : 2 }}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-ink">{label}</span>
        <span className="block text-[10.5px] leading-relaxed text-ink-faint">
          {hint}
        </span>
      </span>
    </div>
  );
}

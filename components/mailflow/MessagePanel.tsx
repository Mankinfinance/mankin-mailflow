"use client";

import * as React from "react";
import { CircleAlert, FlaskConical } from "lucide-react";
import { MIN_AUDIENCE_FOR_TEST, testGroupSize } from "@/lib/campaigns/ab-test";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";

/**
 * Subject, body, and the merge-field machinery around them.
 *
 * The error state is the point of this panel. An unknown merge field
 * renders as a blank, so `{{firstname}}` reaching 180 people means 180
 * emails opening "Hi ,". That is worth blocking a send over, so the
 * banner is welded to the editor's bottom edge rather than floating
 * near it, and the send button in the rail goes held until it clears.
 */

export interface MessagePanelProps {
  name: string;
  subject: string;
  /** Rival subject line. Empty means no A/B test. */
  subjectB: string;
  /** Share of the audience used to decide the test. */
  abTestPercent: number;
  /** How many people the audience currently reaches, so the panel can
   *  say plainly when it is too small to test. */
  audienceSize: number;
  body: string;
  fromBrokerId: string;
  brokers: Array<{ id: string; name: string; initials: string }>;
  unknownFields: string[];
  onChange: (patch: {
    name?: string;
    subject?: string;
    subjectB?: string;
    abTestPercent?: number;
    body?: string;
    fromBrokerId?: string;
  }) => void;
}

/** Closest known field to a typo, by simple edit distance — good enough
 *  to catch firstname → first_name, which is the mistake people make. */
function suggestionFor(unknown: string): string | null {
  let best: { field: string; distance: number } | null = null;
  for (const field of MERGE_FIELDS) {
    const d = editDistance(unknown, field);
    if (!best || d < best.distance) best = { field, distance: d };
  }
  return best && best.distance <= 3 ? best.field : null;
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

export function MessagePanel({
  name,
  subject,
  subjectB,
  abTestPercent,
  audienceSize,
  body,
  fromBrokerId,
  brokers,
  unknownFields,
  onChange,
}: MessagePanelProps) {
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const hasError = unknownFields.length > 0;
  const firstBad = unknownFields[0];
  const suggestion = firstBad ? suggestionFor(firstBad) : null;

  /** Insert at the caret rather than appending — a merge field belongs
   *  in the sentence being written, not at the end of the draft. */
  function insertField(field: string) {
    const el = bodyRef.current;
    const token = `{{${field}}}`;
    if (!el) {
      onChange({ body: body + token });
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    onChange({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function correctIt() {
    if (!firstBad || !suggestion) return;
    const pattern = new RegExp(`\\{\\{\\s*${firstBad}\\s*\\}\\}`, "gi");
    onChange({
      subject: subject.replace(pattern, `{{${suggestion}}}`),
      body: body.replace(pattern, `{{${suggestion}}}`),
    });
  }

  return (
    <PanelShell
      index={1}
      label="Message"
      problem={hasError ? `${unknownFields.length} problem to fix` : null}
    >
      <div className="mb-3 flex gap-2.5">
        <label className="min-w-0 flex-1">
          <FieldLabel>Campaign name</FieldLabel>
          <input
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
          />
        </label>
        <label className="w-[236px] shrink-0">
          <FieldLabel>Send from</FieldLabel>
          <select
            value={fromBrokerId}
            onChange={(e) => onChange({ fromBrokerId: e.target.value })}
            className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
          >
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 flex items-baseline justify-between">
          <FieldLabel inline>Subject line</FieldLabel>
          <span className="text-[10.5px] text-ink-faint">
            {subject.length} characters
            {subject.length > 0 && subject.length <= 45
              ? ", shows in full on a phone"
              : subject.length > 45
                ? ", may truncate on a phone"
                : ""}
          </span>
        </span>
        <input
          value={subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="{{first_name}}, your {{lender}} rate is worth a look"
          className="mono h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
        />
      </label>

      <AbTestField
        subjectB={subjectB}
        abTestPercent={abTestPercent}
        audienceSize={audienceSize}
        onChange={onChange}
      />

      <div>
        <FieldLabel>Body</FieldLabel>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={16}
          placeholder={
            "Hi {{first_name}},\n\nYour {{lender}} loan settled {{years_since_settlement}} years ago…\n\n[Book a 15-minute review]({{booking_url}})"
          }
          className="mono w-full resize-y border px-4 py-3.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
          style={{
            backgroundColor: "#fffdfa",
            lineHeight: 1.6,
            borderColor: hasError ? "#c74b47" : "var(--color-hairline)",
            borderRadius: hasError ? "6px 6px 0 0" : 6,
            borderBottomWidth: hasError ? 0 : 1,
          }}
        />

        {hasError && (
          <div
            className="flex items-start gap-2.5 border px-3.5 py-2.5"
            style={{
              backgroundColor: "#fbf0ef",
              borderColor: "#c74b47",
              borderRadius: "0 0 6px 6px",
            }}
          >
            <CircleAlert
              size={15}
              strokeWidth={1.5}
              className="mt-px shrink-0"
              style={{ color: "#8a3733" }}
            />
            <div className="min-w-0 flex-1">
              <p className="mono text-[11.5px] font-semibold" style={{ color: "#8a3733" }}>
                {`{{${firstBad}}}`} is not a field.
                {suggestion ? ` Did you mean {{${suggestion}}}?` : ""}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "#8a3733" }}>
                Unknown fields send as a blank, so sending is held until this is
                corrected.
              </p>
            </div>
            {suggestion && (
              <button
                type="button"
                onClick={correctIt}
                className="mf-quiet shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#8a3733" }}
              >
                Correct it
              </button>
            )}
          </div>
        )}
      </div>

      <p
        className="mono mt-2.5 rounded-md border px-2.5 py-1.5 text-[10.5px] text-ink-mute"
        style={{
          backgroundColor: "var(--color-paper)",
          borderColor: "var(--color-hairline)",
        }}
      >
        **bold** · a line ending in : is a heading · - starts a bullet ·
        [label](url) is a link
      </p>

      <div className="mt-2.5">
        <FieldLabel>Merge fields, click to insert</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => insertField(f)}
              className="mono mf-quiet rounded-[3px] border px-1.5 py-0.5 text-[11px] transition-colors"
              style={{
                backgroundColor: "#eaeefe",
                borderColor: "#dfe5fa",
                color: "#161461",
              }}
            >
              {`{{${f}}}`}
            </button>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */

export function PanelShell({
  index,
  label,
  problem,
  note,
  children,
}: {
  index: number;
  label: string;
  problem?: string | null;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-[10px] border border-hairline bg-surface px-3.5 py-3.5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="mb-3 flex items-center gap-2 border-b border-hairline pb-2.5">
        <span
          className="flex h-[19px] w-[19px] items-center justify-center rounded-full text-[11px] font-bold"
          style={{ backgroundColor: "#eaeefe", color: "#161461" }}
        >
          {index}
        </span>
        <span
          className="text-[10.5px] font-bold uppercase text-ink-faint"
          style={{ letterSpacing: "0.12em" }}
        >
          {label}
        </span>
        {note && (
          <span className="text-[11px] italic text-ink-faint">{note}</span>
        )}
        {problem && (
          <span className="ml-auto text-[11px] font-semibold text-danger">
            {problem}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <span
      className={`${inline ? "" : "mb-1 block"} text-[11.5px] font-semibold text-ink-soft`}
    >
      {children}
    </span>
  );
}

/**
 * The subject line A/B test.
 *
 * Off by default and collapsed to one line, because most campaigns
 * should not run one — a test costs the delay before the bulk of the
 * audience hears anything, and at a few hundred recipients it only
 * repays that on a subject the broker is genuinely torn about.
 *
 * When the audience is too small the control says so and refuses,
 * rather than accepting a test that would split forty people into two
 * arms of twenty and report noise as a result.
 */
function AbTestField({
  subjectB,
  abTestPercent,
  audienceSize,
  onChange,
}: {
  subjectB: string;
  abTestPercent: number;
  audienceSize: number;
  onChange: (patch: { subjectB?: string; abTestPercent?: number }) => void;
}) {
  const on = subjectB.length > 0;
  const tooSmall = audienceSize > 0 && audienceSize < MIN_AUDIENCE_FOR_TEST;
  const inTest = testGroupSize(audienceSize, abTestPercent);

  if (!on) {
    return (
      <div className="mb-3">
        <button
          type="button"
          disabled={tooSmall}
          onClick={() => onChange({ subjectB: " " })}
          className="mf-quiet flex items-center gap-1 text-[11.5px] font-semibold text-brand transition-opacity hover:opacity-70 disabled:opacity-40"
        >
          <FlaskConical size={12} strokeWidth={1.8} />
          Test a second subject line
        </button>
        {tooSmall && (
          <p className="mt-1 text-[10.5px] text-ink-faint">
            Needs at least {MIN_AUDIENCE_FOR_TEST} recipients. Below that the
            two halves are too small to tell apart.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="mb-3 rounded-md border px-3 py-2.5"
      style={{ backgroundColor: "#fbf8f1", borderColor: "#e8ddc6" }}
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <FieldLabel inline>Subject line B</FieldLabel>
        <button
          type="button"
          onClick={() => onChange({ subjectB: "" })}
          className="mf-quiet text-[10.5px] font-semibold text-ink-mute transition-opacity hover:opacity-70"
        >
          Remove the test
        </button>
      </div>
      <input
        value={subjectB}
        onChange={(e) => onChange({ subjectB: e.target.value })}
        placeholder="A different angle on the same email"
        className="mono h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-mute">Decide on</span>
        {[10, 20, 30, 40, 50].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange({ abTestPercent: p })}
            className="mf-quiet rounded-full border px-2 py-px text-[11px] font-semibold transition-colors"
            style={
              abTestPercent === p
                ? { backgroundColor: "#161461", borderColor: "#161461", color: "#fff" }
                : { borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }
            }
          >
            {p}%
          </button>
        ))}
      </div>

      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
        {inTest > 0 ? (
          <>
            {inTest} people see the two subjects, {inTest / 2} each. Four hours
            later the one with more opens goes to the remaining{" "}
            {audienceSize - inTest}.
          </>
        ) : (
          <>
            This audience is too small to split. Remove the test, or widen the
            audience past {MIN_AUDIENCE_FOR_TEST}.
          </>
        )}
      </p>
    </div>
  );
}

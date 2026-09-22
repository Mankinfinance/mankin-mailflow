"use client";

import * as React from "react";
import { CalendarClock, Lock, LoaderCircle } from "lucide-react";
import type { AudiencePreview } from "@/app/(mailflow)/marketing/campaigns/actions";
import { formatHour, type SendWindow } from "@/lib/campaigns/engagement";

/**
 * "This reaches" — the rail that makes the consequence of sending
 * unavoidable.
 *
 * Two things carry that. The arithmetic is shown rather than summarised:
 * matched, minus the do-not-market list, minus no-email, minus
 * already-counted. And the primary button names the count, so the last
 * thing read before sending is the number of people it goes to.
 *
 * The count recomputes constantly while someone is thinking, so the
 * loading state is designed rather than defaulted: the previous figure
 * stays legible under a shimmer, nothing collapses and nothing jumps.
 */

export interface ReachRailProps {
  preview: AudiencePreview | null;
  recounting: boolean;
  /** Merge-field problems that hold the send. */
  blockedBy: string[];
  scheduledFor: string;
  onScheduledForChange: (value: string) => void;
  /** The hour this list clicks most, from every click ever recorded.
   *  Null when there have not been enough to say. */
  bestHour: SendWindow | null;
  onSaveDraft: () => void;
  onSendTest: () => void;
  onSaveAsTemplate: () => void;
  onSend: () => void;
  pending: boolean;
  status: { tone: "ok" | "error"; text: string } | null;
}

export function ReachRail({
  preview,
  recounting,
  blockedBy,
  scheduledFor,
  onScheduledForChange,
  bestHour,
  onSaveDraft,
  onSendTest,
  onSaveAsTemplate,
  onSend,
  pending,
  status,
}: ReachRailProps) {
  const count = preview?.count ?? 0;
  const blocked = blockedBy.length > 0;
  const empty = count === 0;

  return (
    <div className="flex w-[320px] shrink-0 flex-col gap-3.5 self-start lg:sticky lg:top-3.5">
      {/* ── Card 1: the count and its arithmetic ── */}
      <section
        className="overflow-hidden rounded-[10px] border border-hairline bg-surface"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="px-3.5 py-3"
          style={{ backgroundColor: "#f7f9ff" }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10.5px] font-bold uppercase text-brand"
              style={{ letterSpacing: "0.12em" }}
            >
              This reaches
            </span>
            {recounting && (
              <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">
                <LoaderCircle size={11} strokeWidth={2} className="animate-spin" />
                recounting
              </span>
            )}
          </div>

          {recounting && preview ? (
            <RecountingBody previousCount={count} />
          ) : (
            <>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span
                  className="text-[40px] leading-none tabular-nums"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    color: empty ? "var(--color-ink-zero)" : "#0c034b",
                  }}
                >
                  {count}
                </span>
                <span className="text-[12.5px] text-ink-mute">
                  {count === 1 ? "person" : "people"}
                </span>
              </div>

              {preview && (
                <div
                  className="mt-2 text-[11px] text-ink-mute"
                  style={{ lineHeight: 1.65 }}
                >
                  <div>{preview.matched} matched the rules above</div>
                  {preview.suppressed > 0 && (
                    <div>− {preview.suppressed} on the do-not-market list</div>
                  )}
                  {preview.droppedNoEmail > 0 && (
                    <div>− {preview.droppedNoEmail} with no email on file</div>
                  )}
                  {preview.droppedDuplicate > 0 && (
                    <div>
                      − {preview.droppedDuplicate} already counted from another
                      source
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {preview && preview.sample.length > 0 && (
          <div className="border-t border-hairline px-3.5 py-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span
                className="text-[10.5px] font-bold uppercase text-ink-faint"
                style={{ letterSpacing: "0.12em" }}
              >
                Eight of them
              </span>
              <span className="text-[10.5px] text-ink-mute">
                of {count}
              </span>
            </div>
            <ul>
              {preview.sample.map((s) => (
                <li
                  key={s.email}
                  className="flex items-baseline justify-between gap-2 border-b py-1.5 last:border-0"
                  style={{ borderColor: "#f2f1ea" }}
                >
                  <span className="truncate text-[12px] font-semibold text-ink">
                    {s.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-mute">
                    {s.context || s.source}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Card 2: send ── */}
      <section
        className="rounded-[10px] border border-hairline bg-surface px-3.5 py-3.5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <label className="mb-1 block text-[11.5px] font-semibold text-ink-soft">
          Schedule for
          <span className="ml-1 font-normal text-ink-faint">optional</span>
        </label>
        <div className="relative mb-3">
          <CalendarClock
            size={13}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => onScheduledForChange(e.target.value)}
            className="mono h-[34px] w-full rounded-md border border-hairline bg-surface pl-7 pr-2 text-[12px] text-ink"
          />
        </div>

        {bestHour && (
          <p className="mb-3 -mt-1.5 text-[11px] leading-relaxed text-ink-mute">
            This list clicks most around{" "}
            <strong className="font-semibold text-ink-soft">
              {formatHour(bestHour.hour)}
            </strong>
            , across {bestHour.sampleSize} clicks.{" "}
            <button
              type="button"
              onClick={() => onScheduledForChange(nextOccurrence(bestHour.hour))}
              className="mf-quiet font-semibold text-brand underline underline-offset-2"
            >
              Use it
            </button>
          </p>
        )}

        <div className="mb-2.5 grid grid-cols-2 gap-2">
          <GhostButton onClick={onSaveDraft} disabled={pending}>
            Save draft
          </GhostButton>
          <GhostButton onClick={onSendTest} disabled={pending}>
            Send me a test
          </GhostButton>
          <GhostButton onClick={onSaveAsTemplate} disabled={pending}>
            Save as template
          </GhostButton>
        </div>

        <SendButton
          count={count}
          blocked={blocked}
          empty={empty}
          scheduled={Boolean(scheduledFor)}
          pending={pending}
          onClick={onSend}
        />

        {blocked && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-danger">
            <Lock size={12} strokeWidth={1.5} className="mt-px shrink-0" />
            Held until the unknown merge field is corrected
          </p>
        )}
        {!blocked && empty && (
          <p className="mt-2 text-[11px] text-ink-mute">
            No one matches these rules yet. Widen a condition above.
          </p>
        )}
        {status && (
          <p
            className={`mt-2 text-[11.5px] font-semibold ${
              status.tone === "ok" ? "text-ok" : "text-danger"
            }`}
          >
            {status.text}
          </p>
        )}

        <p className="mt-3 border-t border-hairline pt-2.5 text-[10.5px] leading-relaxed text-ink-faint">
          Sending writes the audience rules, the sender and the recipient count
          to the audit log.
        </p>
      </section>
    </div>
  );
}

/** The previous figure stays readable while the new one is computed. */
function RecountingBody({ previousCount }: { previousCount: number }) {
  return (
    <>
      <div className="mt-1.5 h-[34px] w-[118px] rounded-[5px] mf-shimmer" />
      <div className="mt-2.5 space-y-1.5">
        <div className="h-2 w-[180px] rounded-full mf-shimmer" />
        <div className="h-2 w-[150px] rounded-full mf-shimmer" />
        <div className="h-2 w-[164px] rounded-full mf-shimmer" />
      </div>
      <p className="mt-2.5 text-[11px] text-ink-mute">
        Last count {previousCount}, a moment ago
      </p>
    </>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Weighted to its consequence, and it names the count. The two disabled
 * variants are visually distinct from each other: a held send (something
 * to fix) reads differently from an empty audience (something to widen).
 */
function SendButton({
  count,
  blocked,
  empty,
  scheduled,
  pending,
  onClick,
}: {
  count: number;
  blocked: boolean;
  empty: boolean;
  scheduled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const disabled = blocked || empty || pending;

  const style = blocked
    ? { backgroundColor: "#e0ddd5", color: "#9a9791" }
    : empty
      ? { backgroundColor: "#eceae4", color: "#a5a8b0" }
      : { backgroundColor: "#e3ad4b", color: "#2c1d02" };

  const label = empty
    ? "Send campaign"
    : scheduled
      ? `Schedule for ${count} ${count === 1 ? "person" : "people"}`
      : `Send to ${count} ${count === 1 ? "person" : "people"}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={style}
      className="mf-quiet h-11 w-full rounded-lg text-[13.5px] font-bold transition-colors"
    >
      {pending ? "Working…" : label}
    </button>
  );
}

/**
 * The next time it is `hour` o'clock, as a datetime-local value.
 *
 * Computed in the browser's own zone rather than converted into
 * Australia/Sydney, because a datetime-local input is read back in the
 * browser's zone too — converting would show the broker a time an hour
 * or two from the one they asked for. The firm and its clients are in
 * one zone, so the two agree in practice.
 */
function nextOccurrence(hour: number): string {
  const at = new Date();
  at.setMinutes(0, 0, 0);
  if (at.getHours() >= hour) at.setDate(at.getDate() + 1);
  at.setHours(hour);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(hour)}:00`;
}

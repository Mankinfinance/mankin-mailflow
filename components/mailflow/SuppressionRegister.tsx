"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  suppressEmailAction,
  unsuppressEmailAction,
} from "@/app/(mailflow)/marketing/campaigns/actions";
import { Eyebrow } from "./MailflowPage";

/**
 * The opt-out register.
 *
 * Adding is routine and its button is navy, not gold — honouring an
 * opt-out is an obligation, not a promotion, and gold in this module
 * means "we are about to market to people".
 *
 * Removing is where the care goes. Taking someone off means marketing to
 * a person who once asked us not to, so the confirmation states who,
 * when they opted out, and what removing them actually permits — and the
 * safe action carries the visual weight. The destructive one is warm and
 * deliberate rather than a red button, because red reads as "dangerous,
 * be careful" when the honest framing is "allowed, but only if they
 * asked".
 */

export interface RegisterRow {
  email: string;
  reason: string;
  addedBy: string;
  createdAt: string;
  /** Where the opt-out came from, in a phrase. */
  provenance: string;
}

const HOW_TONE: Record<string, { bg: string; ink: string; line: string }> = {
  unsubscribe: { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" },
  bounce: { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd" },
  manual: { bg: "#f6f8ff", ink: "#4151a8", line: "#cfd7f5" },
};

export function SuppressionRegister({
  rows,
  brokers,
  currentBrokerId,
}: {
  rows: RegisterRow[];
  brokers: Array<{ id: string; name: string }>;
  currentBrokerId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [addedBy, setAddedBy] = React.useState(currentBrokerId);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<RegisterRow | null>(null);
  const [pending, startTransition] = React.useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await suppressEmailAction(email);
      if (result.ok) {
        setEmail("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(row: RegisterRow) {
    startTransition(async () => {
      await unsuppressEmailAction(row.email);
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3.5">
      {/* ── Add by hand ── */}
      <section
        className="rounded-[10px] border border-hairline bg-surface px-3.5 py-3.5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <Eyebrow className="mb-2.5">Add by hand</Eyebrow>
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@example.com"
            className="mono h-[34px] min-w-[240px] flex-1 rounded-md border border-hairline bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
          />
          <select
            value={addedBy}
            onChange={(e) => setAddedBy(e.target.value)}
            className="h-[34px] w-[190px] rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
          >
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                Added by {b.name.split(" ")[0]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="mf-quiet h-[34px] rounded-md px-3.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#161461" }}
          >
            Add to register
          </button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
          Record the request the same day. The address is excluded from the next
          send whether or not it is in the book.
        </p>
        {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      </section>

      {/* ── Removal confirmation, in place of the table while open ── */}
      {confirming && (
        <section
          className="rounded-[10px] border px-4 py-4"
          style={{ backgroundColor: "#fffdf9", borderColor: "#e5d9bd" }}
        >
          <Eyebrow className="mb-2">Removing someone — confirmation</Eyebrow>
          <h3
            className="mb-2 text-[17px] text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Market to {confirming.email} again?
          </h3>
          <p className="mb-3.5 max-w-[560px] text-[12.5px] leading-relaxed text-ink-soft">
            They came off the list on{" "}
            {new Date(confirming.createdAt).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {confirming.reason === "unsubscribe"
              ? " by unsubscribing themselves"
              : confirming.reason === "bounce"
                ? " after their address bounced"
                : ""}
            . Taking them off the register means they can receive campaigns
            again, and they did not ask for that. Only continue if they have
            since asked to hear from us.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface px-3.5 text-[12.5px] font-bold text-brand transition-colors hover:bg-paper-warm"
            >
              Keep them on the register
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => remove(confirming)}
              className="mf-quiet h-[34px] rounded-md border px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "#fdf8ee",
                borderColor: "#d4bfa0",
                color: "#8a6a22",
              }}
            >
              Remove, and log it against my name
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] text-ink-mute">
            Recorded in the compliance audit log with your name and the time.
          </p>
        </section>
      )}

      {/* ── The register ── */}
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-hairline bg-surface px-6 py-10 text-center">
          <p className="text-[13px] font-semibold text-ink">
            Nobody has opted out
          </p>
          <p className="mx-auto mt-1 max-w-[380px] text-[12px] text-ink-mute">
            Unsubscribe clicks land here automatically. Opt-outs that arrive by
            phone or by reply are added above.
          </p>
        </div>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border border-hairline bg-surface"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                <Th>Email</Th>
                <Th>How they came off</Th>
                <Th align="right">Date</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = HOW_TONE[r.reason] ?? HOW_TONE.unsubscribe;
                return (
                  <tr
                    key={r.email}
                    className="border-t"
                    style={{ borderColor: "var(--color-hairline-softer)" }}
                  >
                    <td className="px-3.5 py-2.5">
                      <span className="mono block truncate text-[11.5px] text-ink">
                        {r.email}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-mute">
                        {r.provenance}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span
                        className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                        style={{
                          backgroundColor: tone.bg,
                          color: tone.ink,
                          borderColor: tone.line,
                        }}
                      >
                        {r.reason === "manual"
                          ? `Added by ${r.addedBy}`
                          : r.reason === "bounce"
                            ? "Bounce"
                            : "Unsubscribe"}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-mute">
                      {new Date(r.createdAt).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setConfirming(r)}
                        className="text-[11.5px] font-semibold text-ink-mute underline decoration-hairline underline-offset-2 hover:text-ink"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3.5 py-2 text-[10.5px] font-bold uppercase text-ink-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ letterSpacing: "0.12em" }}
    >
      {children}
    </th>
  );
}

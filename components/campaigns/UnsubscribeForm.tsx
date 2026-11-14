"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  confirmUnsubscribeAction,
  savePreferencesAction,
  saveUnsubscribeFeedbackAction,
} from "@/app/e/u/[token]/actions";
import { UNSUBSCRIBE_REASONS } from "@/lib/campaigns/unsubscribe-reasons";

/**
 * The customer's unsubscribe card — the only screen in the product a
 * customer ever sees.
 *
 * Deliberately not gold: gold marks our marketing actions, and this is
 * theirs. One navy button, no "are you sure", no attempt to talk anyone
 * out of it. The one question - why - comes only after they are already
 * unsubscribed, is optional, and changes nothing about the opt-out.
 *
 * The done state carries the one thing worth explaining — that loan
 * correspondence continues — because a customer mid-application who
 * unsubscribes should not be left wondering whether they have just cut
 * themselves off from their own settlement.
 */

interface UnsubscribeFormProps {
  token: string;
  email: string;
  /** Topics from Settings. Empty hides the "hear less" choices. */
  topics?: Array<{ id: string; label: string }>;
  /** Topics this person has already turned off. */
  optedOut?: string[];
}

export function UnsubscribeForm({ token, email, topics = [], optedOut = [] }: UnsubscribeFormProps) {
  const [state, setState] = React.useState<"idle" | "working" | "done" | "error">(
    "idle",
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    const result = await confirmUnsubscribeAction(token);
    setState(result.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <>
        <div
          className="mx-auto mb-3.5 flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--color-ok-soft)" }}
        >
          <Check size={17} strokeWidth={2} style={{ color: "var(--color-ok)" }} />
        </div>
        <h1
          className="mb-2.5 text-[23px] text-brand-deep"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500, lineHeight: 1.25 }}
        >
          You&apos;re unsubscribed
        </h1>
        <p className="text-[13px] leading-relaxed text-ink-mute">
          We have removed <span className="mono text-[12px] text-ink">{email}</span>{" "}
          from Mankin Finance marketing email. Nothing further is needed.
        </p>
        <div className="my-4 h-px w-full bg-hairline" />
        <h2 className="mb-1.5 text-[12.5px] font-bold text-ink">
          If you have a loan with us
        </h2>
        <p className="text-[12.5px] leading-relaxed text-ink-mute">
          Your broker will still be in touch about your application, your
          settlement and anything else your loan requires. That correspondence
          is part of the service, not marketing.
        </p>
        <div className="my-4 h-px w-full bg-hairline" />
        <WhyQuestion token={token} />
      </>
    );
  }

  return (
    <>
      <h1
        className="mb-2.5 text-[23px] text-brand-deep"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500, lineHeight: 1.25 }}
      >
        Unsubscribe from Mankin Finance updates
      </h1>
      <p className="mb-2.5 text-[13px] text-ink-mute">
        We will stop sending marketing email to
      </p>
      <div
        className="mono mb-4 rounded-md border px-3 py-2 text-[13px] text-ink"
        style={{
          backgroundColor: "var(--color-paper)",
          borderColor: "var(--color-hairline)",
          wordBreak: "break-all",
        }}
      >
        {email}
      </div>
      <form onSubmit={handleSubmit}>
        <button
          type="submit"
          disabled={state === "working"}
          className="mf-quiet h-12 w-full rounded-lg text-[13.5px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
          style={{ backgroundColor: "#161461" }}
        >
          {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      </form>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-mute">
        It takes effect immediately. You do not need an account and nothing else
        is asked of you.
      </p>
      {topics.length > 0 && (
        <HearLess token={token} topics={topics} optedOut={optedOut} />
      )}
      {state === "error" && (
        <p className="mt-3 text-[12px] text-danger">
          Something went wrong on our end. Email{" "}
          <a className="underline" href="mailto:support@mankinfinance.com">
            support@mankinfinance.com
          </a>{" "}
          and we will take you off the list by hand.
        </p>
      )}
    </>
  );
}

/**
 * "Mind telling us why?" Optional, after the fact, one tap. Nothing
 * here can undo or delay the unsubscribe above it.
 */
function WhyQuestion({ token }: { token: string }) {
  const [state, setState] = React.useState<"ask" | "other" | "sending" | "thanks">("ask");
  const [note, setNote] = React.useState("");

  async function send(reason: string, text?: string) {
    setState("sending");
    await saveUnsubscribeFeedbackAction(token, reason, text);
    // Thanked either way: a failure here costs us an answer, not them anything.
    setState("thanks");
  }

  if (state === "thanks") {
    return <p className="text-[12.5px] text-ink-mute">Thank you, that helps.</p>;
  }

  return (
    <div className="text-left">
      <h2 className="mb-2 text-[12.5px] font-bold text-ink">
        Mind telling us why? <span className="font-normal text-ink-faint">(optional)</span>
      </h2>
      {state === "other" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send("other", note);
          }}
        >
          <textarea
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-hairline bg-surface px-2.5 py-2 text-[12.5px] text-ink"
            aria-label="Your reason"
          />
          <button
            type="submit"
            className="mt-2 rounded-md border border-hairline px-3 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-paper-warm"
          >
            Send
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {UNSUBSCRIBE_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={state === "sending"}
              onClick={() => (r.id === "other" ? setState("other") : void send(r.id))}
              className="rounded-full border border-hairline px-3 py-1.5 text-[12px] text-ink-soft hover:bg-paper-warm disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Or hear less." The alternative to leaving altogether: untick what
 * they don't want. Below the unsubscribe button, never in front of it,
 * so nobody has to get past it to leave.
 */
function HearLess({
  token,
  topics,
  optedOut,
}: {
  token: string;
  topics: Array<{ id: string; label: string }>;
  optedOut: string[];
}) {
  const [keep, setKeep] = React.useState<Set<string>>(
    () => new Set(topics.map((t) => t.id).filter((id) => !optedOut.includes(id))),
  );
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  function toggle(id: string) {
    setState("idle");
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const result = await savePreferencesAction(token, [...keep]);
    setState(result.ok ? "saved" : "error");
  }

  return (
    <form onSubmit={save} className="mt-5 border-t border-hairline pt-4 text-left">
      <h2 className="mb-1 text-[12.5px] font-bold text-ink">Or just hear less</h2>
      <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink-mute">
        Untick what you don&apos;t want. Notes from your broker without a topic will
        still come; to stop everything, use Unsubscribe above.
      </p>
      <div className="space-y-1.5">
        {topics.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={keep.has(t.id)}
              onChange={() => toggle(t.id)}
              className="h-4 w-4"
            />
            {t.label}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={state === "saving"}
        className="mt-3 h-10 w-full rounded-lg border text-[13px] font-semibold text-brand-deep disabled:opacity-60"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {state === "saving" ? "Saving…" : "Save my choices"}
      </button>
      {state === "saved" && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--color-ok)" }}>
          Saved. You&apos;ll only get what&apos;s ticked.
        </p>
      )}
      {state === "error" && (
        <p className="mt-2 text-[12px] text-danger">
          That didn&apos;t save. Try again, or use Unsubscribe above.
        </p>
      )}
    </form>
  );
}

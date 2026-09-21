"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { confirmUnsubscribeAction } from "@/app/e/u/[token]/actions";

/**
 * The customer's unsubscribe card — the only screen in the product a
 * customer ever sees.
 *
 * Deliberately not gold: gold marks our marketing actions, and this is
 * theirs. One navy button, no survey, no "are you sure", no attempt to
 * talk anyone out of it.
 *
 * The done state carries the one thing worth explaining — that loan
 * correspondence continues — because a customer mid-application who
 * unsubscribes should not be left wondering whether they have just cut
 * themselves off from their own settlement.
 */

interface UnsubscribeFormProps {
  token: string;
  email: string;
}

export function UnsubscribeForm({ token, email }: UnsubscribeFormProps) {
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

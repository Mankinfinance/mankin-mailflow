"use client";

import * as React from "react";
import { FIELD_LABELS, type FormConfig, type FormField } from "@/lib/forms/types";

/**
 * The form a customer actually fills in.
 *
 * Rendered on the hosted page and inside the embed. Kept deliberately
 * plain: no marketing chrome, no countdown, no second ask after the
 * first. Someone enquiring about a mortgage has already decided to make
 * contact, and the job of the form is to not lose them between deciding
 * and sending.
 */

export function PublicForm({
  formId,
  config,
  compact = false,
  pageId,
}: {
  formId: string;
  config: FormConfig;
  compact?: boolean;
  /** Set when the form is embedded in a landing page, so the enquiry
   *  is attributed to the page it came through rather than counted
   *  only against the form. */
  pageId?: string;
}) {
  const [state, setState] = React.useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [error, setError] = React.useState<string | null>(null);

  // Count the impression once, so the conversion rate has a denominator.
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/forms/${formId}/view`, {
      method: "POST",
      signal: controller.signal,
    }).catch(() => {
      /* Counting must never break the form. */
    });
    return () => controller.abort();
  }, [formId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");

    const data = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      payload[key] = typeof value === "string" ? value : "";
    }

    try {
      const resp = await fetch(`/api/forms/${formId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageId ? { ...payload, pageId } : payload),
      });
      const result = (await resp.json()) as
        | { ok: true; thanks: string }
        | { ok: false; error: string };
      if (result.ok) {
        setState("done");
      } else {
        setError(result.error);
        setState("error");
      }
    } catch {
      setError("Something went wrong on our end. Please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className={compact ? "" : "text-center"}>
        <p className="text-[14px] leading-relaxed text-ink">{config.thanks}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!compact && (
        <div>
          <h1
            className="text-[22px] leading-tight text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            {config.headline}
          </h1>
          {config.blurb && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-mute">
              {config.blurb}
            </p>
          )}
        </div>
      )}

      {config.fields.map((field) => (
        <Field key={field} field={field} />
      ))}

      {/* Honeypot: hidden from people, filled in by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <button
        type="submit"
        disabled={state === "sending"}
        className="mf-quiet h-11 w-full rounded-lg text-[13.5px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
        style={{ backgroundColor: "#161461" }}
      >
        {state === "sending" ? "Sending…" : config.buttonLabel}
      </button>

      <p className="text-[10.5px] leading-relaxed text-ink-mute">
        {config.consent}
      </p>

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </form>
  );
}

function Field({ field }: { field: FormField }) {
  const label = FIELD_LABELS[field];
  const shared =
    "w-full rounded-md border border-hairline bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-faint";

  if (field === "message") {
    return (
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-ink-soft">
          {label}
        </span>
        <textarea name={field} rows={3} className={`${shared} py-2`} />
      </label>
    );
  }

  if (field === "loan-purpose") {
    return (
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-ink-soft">
          {label}
        </span>
        <select name={field} className={`${shared} h-11`} defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          <option value="Buy a home">Buy a home</option>
          <option value="Buy an investment">Buy an investment</option>
          <option value="Refinance an existing loan">
            Refinance an existing loan
          </option>
          <option value="Not sure yet">Not sure yet</option>
        </select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-ink-soft">
        {label}
      </span>
      <input
        name={field}
        type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
        autoComplete={
          field === "email" ? "email" : field === "phone" ? "tel" : "name"
        }
        className={`${shared} h-11`}
      />
    </label>
  );
}

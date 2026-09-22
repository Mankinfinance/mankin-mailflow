"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  deleteSurveyAction,
  setSurveyStatusAction,
} from "@/app/(mailflow)/marketing/surveys/actions";

/**
 * Open a survey for answers, close it, or delete it.
 *
 * Closing does not break the link: someone arriving a week late on an
 * old invitation gets a polite page rather than an error, because the
 * alternative reads as the firm having lost interest in what they were
 * about to say.
 */
export function SurveyControls({
  id,
  status,
  hasResponses,
}: {
  id: string;
  status: string;
  hasResponses: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? "That didn't work.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {status === "live" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setSurveyStatusAction(id, "closed"))}
            className="mf-quiet h-[30px] rounded-md border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
          >
            Close
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setSurveyStatusAction(id, "live"))}
            className="mf-quiet h-[30px] rounded-md px-3 text-[12px] font-bold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
          >
            {status === "closed" ? "Reopen" : "Open it"}
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const message = hasResponses
              ? "Delete this survey AND every answer clients have given it? That cannot be undone."
              : "Delete this survey?";
            if (!window.confirm(message)) return;
            startTransition(async () => {
              const result = await deleteSurveyAction(id);
              if (result.ok) router.push("/marketing/surveys");
              else setError(result.error ?? "That didn't work.");
            });
          }}
          className="mf-quiet h-[30px] rounded-md border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-ink-mute transition-colors hover:bg-paper-warm disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {error && (
        <p className="max-w-[320px] text-right text-[11px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}
    </div>
  );
}

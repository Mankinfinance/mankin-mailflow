"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  activateAutomationAction,
  deleteAutomationAction,
  pauseAutomationAction,
} from "@/app/(mailflow)/marketing/automations/actions";

/**
 * Turn a sequence on, stop it, or delete it.
 *
 * Activation surfaces its validation failures in full rather than a
 * generic "could not activate": the problems are things like "this send
 * has no subject yet", which are actionable sentences, and burying them
 * would mean a broker toggling a switch that silently does nothing.
 */
export function AutomationControls({
  id,
  status,
}: {
  id: string;
  status: string;
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
            onClick={() => run(() => pauseAutomationAction(id))}
            className="mf-quiet h-[30px] rounded-md border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => activateAutomationAction(id))}
            className="mf-quiet h-[30px] rounded-md px-3 text-[12px] font-bold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
          >
            {status === "paused" ? "Resume" : "Turn on"}
          </button>
        )}
        {status !== "live" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this sequence and its run history?")) return;
              startTransition(async () => {
                const result = await deleteAutomationAction(id);
                if (result.ok) router.push("/marketing/automations");
                else setError(result.error);
              });
            }}
            className="mf-quiet h-[30px] rounded-md border border-hairline px-2.5 text-[12px] font-semibold transition-colors hover:bg-paper-warm disabled:opacity-50"
            style={{ color: "#8a4b48" }}
          >
            Delete
          </button>
        )}
      </div>
      {error && (
        <p className="max-w-[420px] text-right text-[11.5px] text-danger">{error}</p>
      )}
    </div>
  );
}

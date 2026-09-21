"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from "@/app/(mailflow)/marketing/campaigns/actions";

/**
 * Pause / resume / delete for a campaign that is past the draft stage.
 * Pause leaves the queue intact — it stops the cron picking the campaign
 * up, so a send that is going wrong can be halted mid-flight and picked
 * back up once it's been sorted out.
 */
export function CampaignControls({
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
    <div className="flex items-center gap-2">
      {(status === "sending" || status === "scheduled") && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => pauseCampaignAction(id))}
          className="rounded-md border border-hairline px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-paper-warm disabled:opacity-50"
        >
          Pause
        </button>
      )}
      {status === "paused" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resumeCampaignAction(id))}
          className="rounded-md bg-brand-ink px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Resume
        </button>
      )}
      {status !== "sending" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this campaign and its send records?")) return;
            startTransition(async () => {
              const result = await deleteCampaignAction(id);
              if (result.ok) router.push("/marketing/campaigns");
              else setError(result.error);
            });
          }}
          className="rounded-md border border-hairline px-2.5 py-1.5 text-[11.5px] font-semibold text-danger hover:bg-paper-warm disabled:opacity-50"
        >
          Delete
        </button>
      )}
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </div>
  );
}

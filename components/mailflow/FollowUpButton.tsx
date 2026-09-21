"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Reply } from "lucide-react";
import { followUpNonOpenersAction } from "@/app/(mailflow)/marketing/campaigns/actions";

/**
 * Follow up with the people who never opened.
 *
 * Sits on a finished campaign's report, next to the number it acts on:
 * the useful moment to think about non-openers is while looking at how
 * many there were.
 *
 * The count shown is the number who were sent it and have not opened as
 * of now. It can shrink between seeing it and clicking — someone opens
 * the original in the meantime — and that is fine. The audience is
 * recomputed when the follow-up is created, so what gets mailed is the
 * truth at that moment rather than this number.
 */
export function FollowUpButton({
  campaignId,
  unopened,
}: {
  campaignId: string;
  unopened: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  if (unopened === 0) return null;

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await followUpNonOpenersAction(campaignId);
            if (result.ok) router.push(`/marketing/campaigns/${result.id}`);
            else setError(result.error);
          });
        }}
        className="mf-quiet flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-semibold text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        <Reply size={12} strokeWidth={1.8} />
        Follow up with the {unopened} who did not open
      </button>
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
        Copies the body into a new draft with the subject blank. The subject is
        what they ignored, so it is the part worth changing.
      </p>
    </div>
  );
}

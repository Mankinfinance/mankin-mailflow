"use server";

import { verifyTrackingToken } from "@/lib/campaigns/tracking";
import { recordUnsubscribe } from "@/lib/campaigns/unsubscribe";

/**
 * Honour an unsubscribe. Called from the confirm button on the landing
 * page rather than on page load, because mail scanners and link
 * preview bots fetch every URL in an email — an unsubscribe that fired
 * on GET would quietly opt people out who never clicked anything.
 *
 * Writes to two places: the suppression list, which is what every
 * future campaign checks, and the recipient row, so the campaign's own
 * results show which send prompted it.
 */
export async function confirmUnsubscribeAction(
  token: string,
): Promise<{ ok: boolean; email?: string }> {
  const verified = await verifyTrackingToken(token, "unsubscribe");
  if (!verified.ok) return { ok: false };

  const { cid, em } = verified.claims;
  try {
    /* Shared with the one-click route. Queued, never sent inline: a
       customer waiting on this page should not wait on somebody's CRM
       being reachable. */
    await recordUnsubscribe({ cid, email: em, via: "link" });
    return { ok: true, email: em };
  } catch (err) {
    console.error("[campaign unsubscribe] failed", err);
    return { ok: false };
  }
}

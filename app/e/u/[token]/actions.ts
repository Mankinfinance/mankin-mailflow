"use server";

import { verifyTrackingToken } from "@/lib/campaigns/tracking";
import { recordUnsubscribe } from "@/lib/campaigns/unsubscribe";
import { repos } from "@/lib/db/repos";
import { UNSUBSCRIBE_REASONS } from "@/lib/campaigns/unsubscribe-reasons";
import { currentSettings } from "@/lib/mailflow/current-settings";
import { auditLog } from "@/lib/audit";

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


/**
 * Why they left, if they chose to say. Asked only after the unsubscribe
 * has already happened, and never required: the opt-out does not wait
 * on it and does not depend on it. Recorded against their register
 * entry, so "I never asked for these" can be looked into.
 */
export async function saveUnsubscribeFeedbackAction(
  token: string,
  feedback: string,
  note?: string,
): Promise<{ ok: boolean }> {
  const verified = await verifyTrackingToken(token, "unsubscribe");
  if (!verified.ok) return { ok: false };
  if (!UNSUBSCRIBE_REASONS.some((r) => r.id === feedback)) return { ok: false };
  const text = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  try {
    const saved = await repos().campaign.setSuppressionFeedback(
      verified.claims.em,
      feedback,
      feedback === "other" ? text : null,
    );
    return { ok: saved };
  } catch (err) {
    console.error("[unsubscribe feedback] failed", err);
    return { ok: false };
  }
}

/**
 * Opt down rather than out: keep the topics they still want. Anything
 * not in `keep` is turned off. Unknown ids are ignored, so a stale page
 * can't store topics that no longer exist.
 */
export async function savePreferencesAction(
  token: string,
  keep: string[],
): Promise<{ ok: boolean }> {
  const verified = await verifyTrackingToken(token, "unsubscribe");
  if (!verified.ok) return { ok: false };
  if (!Array.isArray(keep) || keep.length > 50) return { ok: false };
  try {
    const { topics } = await currentSettings();
    const wanted = new Set(keep.filter((k) => typeof k === "string"));
    const optedOut = topics.map((t) => t.id).filter((id) => !wanted.has(id));
    await repos().campaign.setTopicOptOuts(verified.claims.em, optedOut);
    await auditLog({
      actor: { type: "system" },
      action: "preferences.update",
      meta: { optedOut },
    });
    return { ok: true };
  } catch (err) {
    console.error("[preferences] failed", err);
    return { ok: false };
  }
}

"use server";

import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import { verifyTrackingToken } from "@/lib/campaigns/tracking";

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
    await repos().campaign.suppress({
      email: em,
      reason: "unsubscribe",
      campaignId: cid,
      addedBy: "customer",
    });

    /* Queued, never sent inline: a customer waiting on this page
       should not wait on somebody's CRM being reachable. */
    await emitWebhook("contact.unsubscribed", {
      email: em,
      campaignId: cid,
      source: "link",
    });

    const recipient = await repos().campaign.findRecipient(cid, em);
    if (recipient && recipient.unsubscribedAt === null) {
      await repos().campaign.updateRecipient(recipient.id, {
        unsubscribedAt: new Date(),
      });
    }

    await auditLog({
      actor: { type: "system" },
      action: "campaign.unsubscribe",
      meta: { campaignId: cid, email: em },
    });
    return { ok: true, email: em };
  } catch (err) {
    console.error("[campaign unsubscribe] failed", err);
    return { ok: false };
  }
}

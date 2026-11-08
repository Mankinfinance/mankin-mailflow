import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import {
  campaignIdOf,
  findTrackedMessage,
  messageFields,
  parseTrackingId,
} from "./tracked-message";

/**
 * Honour an opt-out, however it arrived.
 *
 * There are four doors: the confirm button on the page the footer link
 * opens; the one-click POST a mail client sends when someone uses its
 * own unsubscribe button (RFC 8058); an email to the unsubscribe
 * mailbox; and a reply to a broker saying "unsubscribe" (the last two
 * are read hourly by reconcile-unsubscribes). They used to be separate code,
 * and they drifted: only the page emitted contact.unsubscribed. The
 * one-click path — Gmail's and Outlook's own button, which is how most
 * people will do it — told no other system, so the CRM kept mailing
 * people who had opted out here. One function now, so they cannot
 * drift again.
 *
 * Order matters. The suppression is written first and on its own: it
 * is the thing the law cares about, and every campaign and sequence
 * checks it before sending. Everything after it is a courtesy, and a
 * failure in a courtesy must never undo the opt-out.
 */
export async function recordUnsubscribe(args: {
  /** The email's tracking id. Absent when the request came by email
   *  (to the unsubscribe mailbox, or a reply), which carries none. */
  cid?: string;
  email: string;
  via: "link" | "one-click" | "email" | "reply";
}): Promise<void> {
  const em = args.email.toLowerCase();

  /* Attribution only when it is a campaign. An automation's tracking
     id is not a uuid, and passing it here made this — the one write
     the law requires — throw in Postgres. Which automation email
     prompted the opt-out is still recorded, on the send, below. */
  await repos().campaign.suppress({
    email: em,
    reason: "unsubscribe",
    campaignId: args.cid ? campaignIdOf(parseTrackingId(args.cid)) : undefined,
    addedBy: "customer",
  });

  try {
    /* Campaign or automation — which email prompted it, so the right
       report shows it and the note lands on the right file. */
    const message = args.cid ? await findTrackedMessage(args.cid, em) : null;
    if (message && message.unsubscribedAt === null) {
      await message.record({ unsubscribedAt: new Date() });
    }

    await emitWebhook("contact.unsubscribed", {
      /* `source` is which sender (campaign or automation) and `via` is
         which door. `source` used to mean the door and held "link";
         nothing subscribed to it had shipped yet, so it was renamed
         rather than overloaded. */
      ...(message
        ? messageFields(message)
        : args.cid
          ? { source: parseTrackingId(args.cid).kind, campaignId: args.cid }
          : { source: null, campaignId: null }),
      email: em,
      name: message?.name ?? null,
      via: args.via,
    });

    await auditLog({
      actor: { type: "system" },
      action:
        args.via === "one-click"
          ? "campaign.unsubscribe.one_click"
          : args.via === "email" || args.via === "reply"
            ? `campaign.unsubscribe.${args.via}`
            : "campaign.unsubscribe",
      meta: { campaignId: args.cid ?? null, email: em },
    });
  } catch (err) {
    console.error("[unsubscribe] recorded, but follow-up failed", err);
  }
}

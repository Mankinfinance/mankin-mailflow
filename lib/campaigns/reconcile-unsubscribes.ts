import "server-only";
import { repos } from "@/lib/db/repos";
import { TEAM } from "@/lib/team";
import { currentSettings } from "@/lib/mailflow/current-settings";
import { listRecentMessages, OutlookReadError } from "@/lib/clients/outlook-read";
import { recordUnsubscribe } from "./unsubscribe";
import {
  isUnsubscribeMailboxRequest,
  isUnsubscribeReply,
  type InboundMessage,
} from "./unsubscribe-requests";

/**
 * Honour unsubscribe requests that arrive as email.
 *
 * The link in the footer and the mail client's own Unsubscribe button
 * act straight away. Two other routes used to go nowhere: an email to
 * the unsubscribe mailbox (offered in every email's List-Unsubscribe
 * header once one is set in Settings), and a client replying
 * "unsubscribe" to their broker. Both are opt-outs the Spam Act says
 * must be honoured, so this reads them every hour and puts the sender
 * on the register, exactly as the link would.
 *
 * Only the sender's own address is acted on. Staff addresses are never
 * suppressed, so a broker forwarding or testing can't opt themselves out.
 */

/** Hourly runs; two days covers a missed run or two. */
const LOOKBACK_DAYS = 2;

export interface UnsubscribeMailResult {
  /** Mailboxes read. */
  mailboxes: number;
  /** Requests found from people not already on the register. */
  unsubscribed: number;
  /** Mailboxes that couldn't be read, with the reason. */
  skipped: Array<{ mailbox: string; reason: string }>;
  needsConsent: boolean;
}

const OWN_DOMAINS = /@mankinfinance\.com(\.au)?$/i;

export async function reconcileUnsubscribeMail(
  opts: { now?: Date } = {},
): Promise<UnsubscribeMailResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const settings = await currentSettings();
  const unsubscribeMailbox = settings.unsubscribeMailto.trim().toLowerCase();
  const brokerMailboxes = [
    ...new Set(TEAM.map((m) => m.email.toLowerCase()).filter(Boolean)),
  ].filter((m) => m !== unsubscribeMailbox);

  const result: UnsubscribeMailResult = {
    mailboxes: 0,
    unsubscribed: 0,
    skipped: [],
    needsConsent: false,
  };

  /* Which mailbox, and which test its mail has to pass. */
  const plan: Array<{ mailbox: string; via: "email" | "reply"; test: (m: InboundMessage) => boolean }> = [
    ...(unsubscribeMailbox
      ? [{ mailbox: unsubscribeMailbox, via: "email" as const, test: isUnsubscribeMailboxRequest }]
      : []),
    ...brokerMailboxes.map((mailbox) => ({ mailbox, via: "reply" as const, test: isUnsubscribeReply })),
  ];

  const requests = new Map<string, "email" | "reply">();
  for (const { mailbox, via, test } of plan) {
    let messages;
    try {
      messages = await listRecentMessages({ mailbox, since });
    } catch (err) {
      result.skipped.push({
        mailbox,
        reason: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
      if (err instanceof OutlookReadError && err.needsConsent) result.needsConsent = true;
      continue;
    }
    result.mailboxes += 1;
    for (const message of messages) {
      const from = message.from.trim().toLowerCase();
      if (!from || OWN_DOMAINS.test(from)) continue;
      if (!test({ from, subject: message.subject, body: message.body })) continue;
      if (!requests.has(from)) requests.set(from, via);
    }
  }

  if (requests.size === 0) return result;
  const already = await repos().campaign.suppressedAmong([...requests.keys()]);
  for (const [email, via] of requests) {
    if (already.has(email)) continue;
    await recordUnsubscribe({ email, via });
    result.unsubscribed += 1;
  }
  return result;
}

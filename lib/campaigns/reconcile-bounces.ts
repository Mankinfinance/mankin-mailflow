import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { teamMember, TEAM } from "@/lib/team";
import {
  listRecentBounceMessages,
  OutlookReadError,
} from "@/lib/clients/outlook-read";
import { parseBounce, shouldSuppress, type ParsedBounce } from "./bounces";

/**
 * Turn bounce messages sitting in brokers' inboxes into register
 * entries, so a dead address stops costing a send every month.
 *
 * The order of operations is the safety property. We first build the set
 * of addresses we actually mailed in recent campaigns, and only then
 * read the mailbox — an address that is not in that set is never
 * suppressed no matter what a bounce body says about it. A quoted
 * footer, a postmaster contact, or a forwarded complaint therefore
 * cannot remove anyone from the list.
 */

/** How far back to look for bounces on each run. */
const LOOKBACK_DAYS = 7;

/** Recipients from campaigns dispatched within this window are eligible
 *  to be matched against a bounce. Wider than the lookback so a slow
 *  bounce still finds its send. */
const RECIPIENT_WINDOW_DAYS = 30;

export interface ReconcileResult {
  /** Mailboxes scanned. */
  mailboxes: number;
  /** Messages that parsed as a bounce for an address we mailed. */
  bounces: number;
  /** Addresses added to the register. */
  suppressed: number;
  /** Soft bounces recorded but not yet acted on. */
  softRecorded: number;
  /** Mailboxes we could not read, with the reason. */
  skipped: Array<{ mailbox: string; reason: string }>;
  /** True when the app registration lacks Mail.Read consent. */
  needsConsent: boolean;
}

export async function reconcileBounces(
  opts: { now?: Date; lookbackDays?: number } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - (opts.lookbackDays ?? LOOKBACK_DAYS));

  const recipientCutoff = new Date(now);
  recipientCutoff.setDate(recipientCutoff.getDate() - RECIPIENT_WINDOW_DAYS);

  const campaignRepo = repos().campaign;
  const campaigns = await campaignRepo.list();

  /* Who did we actually mail recently, and out of which mailbox. Both
     halves matter: the address set gates suppression, and the mailbox
     set tells us whose inbox is worth reading. */
  const mailedAddresses = new Set<string>();
  const mailboxes = new Set<string>();
  const recipientIdByEmail = new Map<string, string>();

  for (const campaign of campaigns) {
    if (!campaign.startedAt || campaign.startedAt < recipientCutoff) continue;
    const sender = teamMember(campaign.fromBrokerId);
    if (sender.email) mailboxes.add(sender.email);

    for (const r of await campaignRepo.listRecipients(campaign.id, {
      statuses: ["sent"],
      limit: 5000,
    })) {
      mailedAddresses.add(r.email);
      // Most recent send wins, so a bounce is attributed to the campaign
      // that most likely caused it.
      recipientIdByEmail.set(r.email, r.id);
    }
  }

  const result: ReconcileResult = {
    mailboxes: mailboxes.size,
    bounces: 0,
    suppressed: 0,
    softRecorded: 0,
    skipped: [],
    needsConsent: false,
  };

  if (mailedAddresses.size === 0) return result;

  const alreadySuppressed = await campaignRepo.suppressedAmong([
    ...mailedAddresses,
  ]);

  /** Soft bounces seen this run, so three in one sweep still counts. */
  const softSeen = new Map<string, number>();

  for (const mailbox of mailboxes) {
    let messages;
    try {
      messages = await listRecentBounceMessages({ mailbox, since });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.skipped.push({ mailbox, reason: reason.slice(0, 200) });
      if (err instanceof OutlookReadError && err.needsConsent) {
        result.needsConsent = true;
      }
      continue;
    }

    for (const message of messages) {
      const bounce = parseBounce(message, mailedAddresses);
      if (!bounce) continue;
      result.bounces += 1;

      if (alreadySuppressed.has(bounce.email)) continue;

      const priorSoft = softSeen.get(bounce.email) ?? 0;
      if (!shouldSuppress(bounce, priorSoft)) {
        softSeen.set(bounce.email, priorSoft + 1);
        result.softRecorded += 1;
        await markRecipientBounced(bounce, recipientIdByEmail, false);
        continue;
      }

      await campaignRepo.suppress({
        email: bounce.email,
        reason: "bounce",
        addedBy: "system",
      });
      alreadySuppressed.add(bounce.email);
      result.suppressed += 1;
      await markRecipientBounced(bounce, recipientIdByEmail, true);

      await auditLog({
        actor: { type: "system" },
        action: "campaign.bounce.suppress",
        meta: {
          email: bounce.email,
          kind: bounce.kind,
          statusCode: bounce.statusCode,
          diagnostic: bounce.diagnostic,
        },
      });
    }
  }

  return result;
}

/**
 * Write the bounce back onto the send record, so the campaign report
 * shows why an address failed rather than just that it did.
 */
async function markRecipientBounced(
  bounce: ParsedBounce,
  recipientIdByEmail: Map<string, string>,
  permanent: boolean,
): Promise<void> {
  const id = recipientIdByEmail.get(bounce.email);
  if (!id) return;
  const label = permanent ? "Hard bounce" : "Soft bounce";
  await repos().campaign.updateRecipient(id, {
    status: "failed",
    error: `${label}${bounce.statusCode ? ` ${bounce.statusCode}` : ""}: ${bounce.diagnostic}`.slice(
      0,
      500,
    ),
  });
}

/** Every mailbox a campaign could have been sent from — used by the
 *  setup page to say which need Mail.Read consent. */
export function sendingMailboxes(): string[] {
  return TEAM.filter((m) => m.email).map((m) => m.email);
}

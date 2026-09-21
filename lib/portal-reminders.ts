import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import type { Deal } from "@/lib/clients/salestrekker";
import { teamMember, type TeamMemberId } from "@/lib/team";
import { dealGreetingFirstName } from "@/lib/deal-subjects";
import { composeDocNudgeEmail } from "@/lib/email-templates";
import { portalUrlForDeal } from "@/lib/portal-link";

/**
 * Portal upload reminder SMS - fires automatically at the day-3 and
 * day-7 marks if a customer still has outstanding portal docs and the
 * broker hasn't spoken to them in the meantime.
 *
 * Cron schedule (vercel.json): daily at 22:00 UTC = 8am AEST / 9am
 * AEDT - so the SMS lands when the customer is starting their day.
 *
 * Dedup: we record an audit entry per send. If a record exists in the
 * past 30 days for this deal + this kind, we skip. The window-based
 * selection (3-5 days idle for day3, 7-9 days idle for day7) prevents
 * a single deal from triggering both reminders in one cycle.
 */

export type ReminderKind = "day3" | "day7";

const REMINDER_ACTION: Record<ReminderKind, string> = {
  day3: "cron.portal_reminder.day3.sent",
  day7: "cron.portal_reminder.day7.sent",
};

const REMINDER_WINDOWS: Record<ReminderKind, { min: number; max: number }> = {
  // 3-5 day window: forgives a single missed cron day without missing
  // the customer entirely. day7 similarly.
  day3: { min: 3, max: 5 },
  day7: { min: 7, max: 9 },
};

const DEDUP_WINDOW_DAYS = 30;

export interface PortalReminderPlan {
  dealId: string;
  dealName: string;
  to: string;
  kind: ReminderKind;
  daysIdle: number;
  outstandingCount: number;
  message: string;
}

/**
 * Pick every deal that qualifies for a reminder right now. Filters:
 *   - open (not settled)
 *   - has at least one outstanding portal doc
 *   - has a customer phone (we need it to SMS)
 *   - daysSinceContact in the right window
 *   - no equivalent reminder sent in the last 30 days (audit check)
 */
export async function selectRemindersToSend(
  deals: Deal[],
): Promise<PortalReminderPlan[]> {
  const auditRepo = repos().audit;
  const out: PortalReminderPlan[] = [];

  for (const deal of deals) {
    if (deal.stageId === "settled") continue;
    const outstandingCount = deal.pending.length + deal.overdue.length;
    if (outstandingCount === 0) continue;
    if (!deal.phone?.trim()) continue;

    const idle = deal.daysSinceContact;
    let kind: ReminderKind | null = null;
    if (idle >= REMINDER_WINDOWS.day7.min && idle <= REMINDER_WINDOWS.day7.max) {
      kind = "day7";
    } else if (
      idle >= REMINDER_WINDOWS.day3.min &&
      idle <= REMINDER_WINDOWS.day3.max
    ) {
      kind = "day3";
    }
    if (!kind) continue;

    /* Skip if we sent the same kind to this deal in the past 30 days.
       audit.list returns rows newest-first, so we only need the top one
       in window to know whether to skip. */
    const recent = await auditRepo.list({
      dealId: deal.id,
      action: REMINDER_ACTION[kind],
      limit: 1,
    });
    if (recent.length > 0) {
      const sentAt = new Date(recent[0].createdAt).getTime();
      const cutoff = Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (sentAt >= cutoff) continue;
    }

    out.push({
      dealId: deal.id,
      dealName: deal.name,
      to: deal.phone,
      kind,
      daysIdle: idle,
      outstandingCount,
      message: buildReminderMessage({ deal, kind, outstandingCount }),
    });
  }

  return out;
}

/**
 * Compose the SMS body. Day-3 leads with a soft nudge; day-7 leans
 * harder on urgency but stays polite. Both end with the broker's
 * direct mobile so the customer can call if it's tricky.
 */
function buildReminderMessage(args: {
  deal: Deal;
  kind: ReminderKind;
  outstandingCount: number;
}): string {
  const { deal, kind, outstandingCount } = args;
  const firstName = dealGreetingFirstName(deal);
  const broker = teamMember(deal.brokerId as TeamMemberId);
  const phone = broker.phone || "0420 699 983";
  const docsWord = outstandingCount === 1 ? "doc" : "docs";

  if (kind === "day3") {
    return [
      `Hi ${firstName}, ${broker.short} from Mankin Finance.`,
      `Just a quick reminder - we still need ${outstandingCount} ${docsWord} from you to push your application forward.`,
      `Your portal link is in the welcome email I sent through. Reply to that email if you've lost it.`,
      `Any trouble, give me a call on ${phone}.`,
    ].join(" ");
  }
  return [
    `Hi ${firstName}, ${broker.short} from Mankin Finance.`,
    `Following up - we're still waiting on ${outstandingCount} ${docsWord} so I can move forward with your application.`,
    `Even one or two would help me make progress this week.`,
    `If anything's tricky to track down please call me on ${phone} and we'll figure it out together.`,
  ].join(" ");
}

/** Record the send to audit_log so dedup catches it on tomorrow's cron run. */
export async function recordReminderSent(args: {
  dealId: string;
  kind: ReminderKind;
  to: string;
  daysIdle: number;
  outstandingCount: number;
}): Promise<void> {
  await auditLog({
    actor: { type: "system" },
    action: REMINDER_ACTION[args.kind],
    dealId: args.dealId,
    meta: {
      kind: args.kind,
      to: args.to,
      daysIdle: args.daysIdle,
      outstandingCount: args.outstandingCount,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Email nudge — complementary channel to the SMS reminders above.     */
/* Fires 3 days after a portal link is issued if no docs have been     */
/* uploaded yet. Uses Outlook app-only (client credentials) so it can  */
/* send without a broker session.                                       */
/* ------------------------------------------------------------------ */

const EMAIL_NUDGE_ACTION = "cron.portal_reminder.email.sent";
const EMAIL_NUDGE_DEDUP_DAYS = 14;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export interface EmailNudgePlan {
  dealId: string;
  dealName: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  daysIdle: number;
}

/**
 * Pick every deal whose portal link was issued 3+ days ago, still has
 * outstanding docs, and has not received an email nudge in the last 14 days.
 * Skips deals where the customer uploaded anything in the past 3 days (active).
 */
export async function selectEmailNudgesToSend(
  deals: Deal[],
): Promise<EmailNudgePlan[]> {
  const auditRepo = repos().audit;
  const tokenRepo = repos().portalTokens;
  const now = Date.now();
  const dedupCutoff = new Date(now - EMAIL_NUDGE_DEDUP_DAYS * 24 * 60 * 60 * 1000);
  const recentActivityCutoff = new Date(now - THREE_DAYS_MS);

  const out: EmailNudgePlan[] = [];

  for (const deal of deals) {
    if (deal.stageId === "settled") continue;
    if (deal.nurturedAt) continue;
    const outstandingCount = deal.pending.length + deal.overdue.length;
    if (outstandingCount === 0) continue;
    if (!deal.email?.trim()) continue;

    // Skip if already email-nudged in the dedup window.
    const recentNudge = await auditRepo.list({
      dealId: deal.id,
      action: EMAIL_NUDGE_ACTION,
      limit: 1,
    });
    if (recentNudge.length > 0 && recentNudge[0].createdAt >= dedupCutoff) continue;

    // Skip if customer uploaded anything recently (they are actively engaging).
    const recentUpload = await auditRepo.list({
      dealId: deal.id,
      action: "portal.upload",
      limit: 1,
    });
    if (recentUpload.length > 0 && recentUpload[0].createdAt >= recentActivityCutoff) continue;

    // Check for an active portal token issued 3+ days ago.
    const tokens = await tokenRepo.listByDeal(deal.id);
    const activeToken = tokens.find(
      (t) =>
        !t.revokedAt &&
        t.expiresAt.getTime() > now &&
        now - t.issuedAt.getTime() >= THREE_DAYS_MS,
    );
    if (!activeToken) continue;

    const broker = teamMember(deal.brokerId as TeamMemberId);
    if (!broker.email) continue;

    // Issue a fresh portal token so the URL in the email is valid.
    const portalUrl = await portalUrlForDeal(deal, "system");

    const { subject, body } = composeDocNudgeEmail({
      deal,
      brokerShort: broker.short,
      brokerPhone: broker.phone || "0420 699 983",
      portalUrl,
    });

    const daysIdle = Math.floor((now - activeToken.issuedAt.getTime()) / 86_400_000);

    out.push({
      dealId: deal.id,
      dealName: deal.name,
      to: deal.email,
      from: broker.email,
      subject,
      body,
      daysIdle,
    });
  }

  return out;
}

/** Record an email nudge so the dedup window prevents re-sending. */
export async function recordEmailNudgeSent(args: {
  dealId: string;
  to: string;
  daysIdle: number;
}): Promise<void> {
  await auditLog({
    actor: { type: "system" },
    action: EMAIL_NUDGE_ACTION,
    dealId: args.dealId,
    meta: { to: args.to, daysIdle: args.daysIdle },
  });
}

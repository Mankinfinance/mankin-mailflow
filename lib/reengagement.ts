import { stageMeta, type Deal } from "@/lib/clients/salestrekker/types";
import { docNameForEmail } from "@/lib/clients/salestrekker/doc-catalog";
import { dealGreetingFirstName, subjectWithMankin } from "@/lib/deal-subjects";
import { customerClosingFor } from "@/lib/customer-closing";

/**
 * Backlog re-engagement sweep — drafts a "hey, where did we leave off?"
 * email for every deal the broker hasn't touched in a while.
 *
 * Differs from EOD briefs:
 *   - On-demand (the broker hits a button) rather than scheduled.
 *   - Selection is "idle 30+ days" rather than "open today".
 *   - Includes nurtured + dormant deals (the whole point of the sweep
 *     is to wake them up).
 *   - In-memory only - we don't store these, the broker reviews +
 *     sends them in one sitting.
 *
 * Pure module - no server-only imports. The server action that wraps
 * it adds the broker session + Graph draft creation.
 */

export const DEFAULT_IDLE_THRESHOLD_DAYS = 30;

export interface ReengagementDraft {
  dealId: string;
  dealName: string;
  dealRef: string;
  to: string;
  /** Days since the broker last contacted the customer - shown on the
   *  card so the broker has context before hitting Send. */
  daysSinceContact: number;
  subject: string;
  body: string;
}

/**
 * Pick the deals that count as "idle". Defaults to 30 days since the
 * broker last spoke to the customer; caller can override.
 *
 * Excludes:
 *   - Settled deals (already done, nothing to wake up)
 *   - Deals with no customer email (we'd have nothing to send)
 *   - Deals the broker has manually flagged to skip auto-updates
 */
export function selectIdleDeals(
  deals: Deal[],
  opts: {
    brokerId: string;
    thresholdDays?: number;
  },
): Deal[] {
  const threshold = opts.thresholdDays ?? DEFAULT_IDLE_THRESHOLD_DAYS;
  return deals.filter(
    (d) =>
      d.brokerId === opts.brokerId &&
      d.stageId !== "settled" &&
      !d.excludeFromDailyUpdates &&
      d.daysSinceContact >= threshold &&
      !!d.email?.trim(),
  );
}

/**
 * Build a deterministic re-engagement draft - subject + body. No LLM
 * call: the broker is sweeping a backlog and wants consistent, polite
 * copy across every send. Mock-friendly + cheap + offline-safe.
 */
export function buildReengagementDraft(args: {
  deal: Deal;
  brokerShort: string;
  brokerId: string;
}): { subject: string; body: string } {
  const { deal, brokerShort, brokerId } = args;
  const firstName = dealGreetingFirstName(deal);
  const meta = stageMeta(deal.stageId);
  const closing = customerClosingFor({ brokerId, brokerShort });

  const subject = subjectWithMankin("Quick check-in on your application", deal);

  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(
    `It's been a while since we last spoke and I wanted to check back in on where you're up to.`,
  );
  lines.push("");

  /* Stage-aware paragraph: tell them where we left off, in their words
     not ours. We pulled them out of active follow-up because no doc
     activity for 30+ days; we want to re-engage gently. */
  if (deal.overdue.length > 0 || deal.pending.length > 0) {
    const outstanding = [
      ...deal.overdue.map((id) => docNameForEmail(deal.customDocs, id)),
      ...deal.pending.map((id) => docNameForEmail(deal.customDocs, id)),
    ].slice(0, 4);
    lines.push(
      `Last time we touched base you were at ${meta.label.toLowerCase()}. From my side it looks like the next thing we were waiting on was:`,
    );
    lines.push("");
    for (const name of outstanding) lines.push(`• ${name}`);
    lines.push("");
    lines.push(
      `Are you still keen to keep moving forward? If life's gotten busy and now's not the right time, no problem at all - I just want to make sure I'm not chasing something you no longer need.`,
    );
  } else {
    lines.push(
      `Last time we touched base you were at ${meta.label.toLowerCase()}. I want to make sure I haven't dropped the ball on anything from my end.`,
    );
    lines.push("");
    lines.push(
      `Are you still keen to keep moving forward? If life's gotten busy and now's not the right time, no problem at all - just let me know either way.`,
    );
  }

  lines.push("");
  lines.push(`If you'd like to start fresh I'm pleased to do that too.`);
  lines.push("");
  lines.push(closing);
  lines.push("");
  lines.push(`Talk soon,`);
  lines.push(brokerShort);

  return { subject, body: lines.join("\n") };
}

/**
 * Build the full batch of re-engagement drafts for a broker's idle
 * deals. Returns one ReengagementDraft per eligible deal, sorted by
 * staleness (most idle first) so the broker tackles the worst offenders
 * before they cool further.
 */
export function buildReengagementBatch(args: {
  deals: Deal[];
  brokerId: string;
  brokerShort: string;
  thresholdDays?: number;
}): ReengagementDraft[] {
  const idle = selectIdleDeals(args.deals, {
    brokerId: args.brokerId,
    thresholdDays: args.thresholdDays,
  });

  const sorted = [...idle].sort(
    (a, b) => b.daysSinceContact - a.daysSinceContact,
  );

  return sorted.map((deal) => {
    const { subject, body } = buildReengagementDraft({
      deal,
      brokerShort: args.brokerShort,
      brokerId: args.brokerId,
    });
    return {
      dealId: deal.id,
      dealName: deal.name,
      dealRef: deal.appRef || deal.id,
      to: deal.email ?? "",
      daysSinceContact: deal.daysSinceContact,
      subject,
      body,
    };
  });
}

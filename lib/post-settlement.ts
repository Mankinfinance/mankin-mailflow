import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { dealGreetingFirstName, subjectWithMankin } from "@/lib/deal-subjects";
import { repos } from "@/lib/db/repos";
import { CLIENT_EXPERIENCE_OFFICER_ID } from "@/lib/team";
import type { PostSettlementCheckInRow } from "@/lib/db/schema";
import {
  CHECK_IN_KINDS,
  CHECK_IN_LABELS,
  CHECK_IN_OFFSET_DAYS,
  type CheckInKind,
} from "@/lib/post-settlement-shared";
import { buildMilestoneContent, type Milestone } from "@/lib/anniversary-content";

// Re-export for callers that used to import these from here. Avoids a
// big rename pass across the codebase.
export {
  CHECK_IN_KINDS,
  CHECK_IN_LABELS,
  CHECK_IN_OFFSET_DAYS,
  type CheckInKind,
};

/**
 * Post-settlement client experience module.
 *
 * Each settled deal gets four scheduled check-ins:
 *   - 3 months after settlement (settling-in check)
 *   - 6 months after settlement (mid-year review + tax prep nudge)
 *   - 9 months after settlement (forward-looking + soft referral ask)
 *   - 12 months after settlement (anniversary review + explicit referral)
 *
 * The Client Experience Officer works through these from the
 * /dashboard/post-settlement page. Each row opens the existing
 * Composer pre-filled with the right template so they can review
 * and send via Salestrekker.
 *
 * Status tracking: derived from the activities table - a "follow-up"
 * activity for this deal within +/- 14 days of a due date counts as
 * that check-in being sent. No separate state table needed.
 */


export interface CheckInRow {
  /** Database id of the underlying post_settlement_checkins row */
  id: string;
  deal: Deal;
  kind: CheckInKind;
  dueAt: Date;
  daysUntilDue: number; // negative = overdue
  status: "overdue" | "due-this-week" | "upcoming" | "sent" | "snoozed";
  sentAt: Date | null;
  snoozedUntil: Date | null;
  assignedTo: string | null;
  /** Pre-drafted email content from the cron, when ready */
  draft: { subject: string; body: string; source: string } | null;
}


/* -------------------------------------------------------------------------- */
/* DB sync                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Idempotent sync: ensures a post_settlement_checkins row exists for
 * every (settled deal, kind) pair. Run on every page render.
 *
 * Builds the full (deal, kind) worklist, then hands it to the repo's
 * bulk ensurePending — one SELECT of existing pairs + one INSERT of the
 * missing ones. Previously this looped every settled deal × 4 kinds and
 * awaited a select-then-insert per pair (up to 2 × 4 × settled serial
 * queries on every page open); now it's two round-trips flat.
 */
export async function syncCheckIns(deals: Deal[]): Promise<void> {
  const settled = deals.filter((d) => d.stageId === "settled" && d.settledOn);

  const entries: Array<{
    dealId: string;
    kind: CheckInKind;
    dueAt: Date;
    assignedTo: string | null;
  }> = [];
  for (const deal of settled) {
    const settledAt = new Date(deal.settledOn as string);
    if (Number.isNaN(settledAt.getTime())) continue;
    for (const kind of CHECK_IN_KINDS) {
      const dueAt = new Date(settledAt);
      dueAt.setDate(dueAt.getDate() + CHECK_IN_OFFSET_DAYS[kind]);
      entries.push({
        dealId: deal.id,
        kind,
        dueAt,
        assignedTo: CLIENT_EXPERIENCE_OFFICER_ID,
      });
    }
  }

  try {
    await repos().postSettlement.ensurePending(entries);
  } catch (err) {
    console.warn("[post-settlement] ensurePending failed", {
      count: entries.length,
      err,
    });
  }
}

/** Combine a DB row with its deal + computed status. */
function toCheckInRow(row: PostSettlementCheckInRow, deal: Deal, asOf: Date): CheckInRow {
  const daysUntilDue = Math.round(
    (row.dueAt.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24),
  );

  let status: CheckInRow["status"];
  if (row.status === "sent") status = "sent";
  else if (row.status === "snoozed") status = "snoozed";
  else if (daysUntilDue < 0) status = "overdue";
  else if (daysUntilDue <= 7) status = "due-this-week";
  else status = "upcoming";

  return {
    id: row.id,
    deal,
    kind: row.kind as CheckInKind,
    dueAt: row.dueAt,
    daysUntilDue,
    status,
    sentAt: row.sentAt,
    snoozedUntil: row.snoozedUntil,
    assignedTo: row.assignedTo,
    draft:
      row.draftSubject && row.draftBody
        ? {
            subject: row.draftSubject,
            body: row.draftBody,
            source: row.draftSource,
          }
        : null,
  };
}

/** Read all check-ins from the DB and join with the deal records.
 *  Filters out snoozed rows whose snooze date is in the future. */
export async function listCheckIns(deals: Deal[], asOf: Date = new Date()): Promise<CheckInRow[]> {
  const repo = repos().postSettlement;
  const rows = await repo.list({ includeDismissed: false });
  const dealsById = new Map(deals.map((d) => [d.id, d] as const));

  const result: CheckInRow[] = [];
  for (const r of rows) {
    // Active snooze: don't show in the main queue.
    if (
      r.status === "snoozed" &&
      r.snoozedUntil &&
      r.snoozedUntil > asOf
    ) {
      continue;
    }
    const deal = dealsById.get(r.dealId);
    if (!deal) continue;
    result.push(toCheckInRow(r, deal, asOf));
  }

  const statusRank: Record<CheckInRow["status"], number> = {
    overdue: 0,
    "due-this-week": 1,
    upcoming: 2,
    sent: 3,
    snoozed: 4,
  };

  return result.sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    return a.dueAt.getTime() - b.dueAt.getTime();
  });
}

function firstName(deal: Deal): string {
  // Joint-applicant aware: "Sarah and Tom" when the deal has two
  // applicants captured, single first name otherwise.
  return dealGreetingFirstName(deal);
}

/* -------------------------------------------------------------------------- */
/* Check-in computation                                                       */
/* -------------------------------------------------------------------------- */

/** Quick count for the sidebar badge: overdue + due-this-week combined. */
export function urgentCheckInCount(rows: CheckInRow[]): number {
  return rows.filter(
    (r) => r.status === "overdue" || r.status === "due-this-week",
  ).length;
}

/* -------------------------------------------------------------------------- */
/* Email templates                                                            */
/* -------------------------------------------------------------------------- */

export interface CheckInEmail {
  subject: string;
  body: string;
}

export interface CheckInContext {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
}

function subjectFor(kind: CheckInKind, deal: Deal): string {
  return subjectWithMankin(CHECK_IN_LABELS[kind], deal);
}

// Use the single source of truth in lib/anniversary-content.ts so the
// cron-drafted 3 / 6 / 12 month emails match the CX Anniversaries page
// exactly. The helper still threads clawbackStatus through for the
// broker-facing talking points, but customer-facing email bodies must
// NEVER mention clawback - that conversation happens on the call.
function viaMilestoneContent(
  ctx: CheckInContext,
  milestone: Milestone,
  kind: CheckInKind,
): CheckInEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  const content = buildMilestoneContent({
    firstName: firstName(deal),
    settlementDate: deal.settledOn ?? "",
    lender: deal.lender ?? "",
    brokerShort,
    brokerPhone,
    milestone,
  });
  return { subject: subjectFor(kind, deal), body: content.body };
}

function compose3Month(ctx: CheckInContext): CheckInEmail {
  return viaMilestoneContent(ctx, 3, "3mo");
}

function compose6Month(ctx: CheckInContext): CheckInEmail {
  return viaMilestoneContent(ctx, 6, "6mo");
}

function compose9Month(ctx: CheckInContext): CheckInEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  return {
    subject: subjectFor("9mo", deal),
    body: `Hi ${firstName(deal)},

Nine months in. We're getting close to the one-year mark, when I'll do a full annual review of your loan and the market.

Before then, two quick things:

First, anything changed in your situation I should know about? New job, baby on the way, looking at an investment property, planning a renovation? Even a heads-up helps me bring the right options to the table when we do the annual review.

Second, the soft pitch. We grow Mankin off referrals from clients like you. If you know anyone looking at buying, refinancing, or just wanting a second opinion on their current loan, send them my way. I'll look after them the same way I've looked after you.

No need to reply if everything's quiet. I'll send the annual review details closer to your loan anniversary.

Kind regards,
${brokerShort}
Mankin Finance
${brokerPhone}`,
  };
}

function compose12Month(ctx: CheckInContext): CheckInEmail {
  return viaMilestoneContent(ctx, 12, "12mo");
}

export function composeCheckInEmail(
  kind: CheckInKind,
  ctx: CheckInContext,
): CheckInEmail {
  switch (kind) {
    case "3mo":
      return compose3Month(ctx);
    case "6mo":
      return compose6Month(ctx);
    case "9mo":
      return compose9Month(ctx);
    case "12mo":
      return compose12Month(ctx);
  }
}

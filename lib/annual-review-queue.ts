import "server-only";
import { listSettlements, reviewIndex } from "./settlements-store";
import { anniversaryHitsForSettlement } from "./settlements";
import {
  buildMilestoneContent,
  type Milestone,
} from "./anniversary-content";
import { clawbackStatus, type ClawbackStatus } from "./clawback";
import { dealGreetingFirstName } from "./deal-subjects";
import type { SettlementRow } from "./commission-parser";

/**
 * Pending annual reviews queue.
 *
 * Returns every active settlement that has reached its 12-month
 * milestone and hasn't yet been actioned (emailed / booked /
 * dismissed). Used by the CX batch deck so the broker can chew
 * through them like the daily EOD briefs: open the deck, see one
 * card per customer, edit / refine with Claude / send / skip.
 *
 * Window:
 *   - lookaheadDays: how far ahead to surface upcoming reviews
 *   - backlogDays:   how far behind to keep surfacing overdue ones
 *
 * Default: 30 ahead + 60 behind, so the queue holds anything from
 * "due this month" through to "60 days overdue". Tunable per call.
 */

export interface AnnualReviewQueueEntry {
  /** Stable id so the deck can key/track skip state per row. */
  id: string;
  settlement: SettlementRow;
  /** Which milestone the row is for (12 for annual review, 18 for
   *  refinance review). The deck UI uses this for the per-card title. */
  milestone: Milestone;
  /** When the milestone falls (ISO yyyy-mm-dd). */
  milestoneDate: string;
  /** Days until the milestone. Negative = overdue. */
  daysUntil: number;
  /** Clawback status snapshot, used to colour the card + shape the
   *  pre-drafted email body. */
  clawback: ClawbackStatus;
  /** Greeting first name(s) used in the email. */
  firstName: string;
  /** Pre-drafted email subject. Broker can edit. */
  subject: string;
  /** Pre-drafted email body. Broker can edit and refine with Claude. */
  body: string;
}

export interface AnnualReviewQueue {
  /** All entries sorted by daysUntil ascending (most overdue first). */
  entries: AnnualReviewQueueEntry[];
  /** Count of entries whose milestone is overdue (daysUntil < 0). */
  overdueCount: number;
  /** Count of entries due in the next 7 days. */
  dueThisWeek: number;
}

export interface QueueOptions {
  /** Which milestone to build the queue for. Defaults to 12 (annual
   *  review). Use 18 for the refinance review batch. */
  milestone?: Milestone;
  asOf?: Date;
  lookaheadDays?: number;
  backlogDays?: number;
  brokerShort?: string;
  brokerPhone?: string;
}

/** Subject prefix for each milestone. The body content already shifts
 *  via buildMilestoneContent; the subject just needs the right topic
 *  word so customers can scan their inbox.
 *
 *  Keep these aligned with the SOPs and the existing subject convention
 *  ("<Topic> - <Name> x Mankin Finance"). */
const SUBJECT_TOPIC: Record<Milestone, string> = {
  3: "3 month check-in",
  6: "6 month check-in",
  12: "12 month annual review",
  18: "18 month refinance review",
  24: "2 year review",
};

/** Build the queue. Reads settlements + reviews and assembles entries
 *  with the pre-drafted email content already in place.
 *
 *  Same shape works for 12-month annual reviews and 18-month refinance
 *  reviews; the milestone parameter selects which. The 18-month run
 *  inherits the aggressive clawback-clear body from anniversary-content. */
export async function pendingAnnualReviews(
  options: QueueOptions = {},
): Promise<AnnualReviewQueue> {
  const milestone = options.milestone ?? 12;
  const asOf = options.asOf ?? new Date();
  const lookaheadDays = options.lookaheadDays ?? 30;
  const backlogDays = options.backlogDays ?? 60;
  const brokerShort = options.brokerShort ?? "Michael";
  const brokerPhone = options.brokerPhone ?? "0420 699 983";

  const settlements = await listSettlements();
  const idx = await reviewIndex();

  const entries: AnnualReviewQueueEntry[] = [];

  for (const s of settlements) {
    const hits = anniversaryHitsForSettlement(s, {
      today: asOf,
      lookaheadDays,
      backlogDays,
    });
    const hit = hits.find((h) => h.milestone === milestone);
    if (!hit) continue;

    // Skip rows that have already been actioned (emailed / booked /
    // dismissed). Skipped rows that are still snoozed are also
    // filtered out by reviewIndex which only returns active reviews.
    const reviewState = idx.get(s.id)?.get(milestone);
    if (reviewState && reviewState.state !== "skipped") continue;

    const cb = clawbackStatus(s.lender, s.settlementDate, asOf);
    const firstName = dealGreetingFirstName({ name: s.clientName });
    const content = buildMilestoneContent({
      firstName,
      settlementDate: s.settlementDate,
      lender: s.lender,
      brokerShort,
      brokerPhone,
      milestone,
      asOf,
    });

    entries.push({
      id: `${s.id}-${milestone}mo`,
      settlement: s,
      milestone,
      milestoneDate: hit.milestoneDate,
      daysUntil: hit.daysUntil,
      clawback: cb,
      firstName,
      subject: `${SUBJECT_TOPIC[milestone]} - ${s.clientName} x Mankin Finance`,
      body: content.body,
    });
  }

  entries.sort((a, b) => a.daysUntil - b.daysUntil);

  const overdueCount = entries.filter((e) => e.daysUntil < 0).length;
  const dueThisWeek = entries.filter((e) => e.daysUntil >= 0 && e.daysUntil <= 7).length;

  return { entries, overdueCount, dueThisWeek };
}

/**
 * Combined CX review queue across every actionable milestone (3 / 6 /
 * 12 / 18 month). Powers the header "Generate CX reviews" button on the
 * CX Manager pages — one swipeable deck that batches every overdue or
 * imminent customer touchpoint into a single sitting.
 *
 * Each entry keeps its `milestone` so the deck can colour the chip,
 * pick the right copy, and record the action against the correct
 * touchpoint when the broker sends or skips.
 *
 * Sort order matches the per-milestone queue: most overdue first.
 */
export async function pendingCxReviews(
  options: {
    asOf?: Date;
    lookaheadDays?: number;
    backlogDays?: number;
    brokerShort?: string;
    brokerPhone?: string;
    /** Milestones to include. Defaults to the four actionable ones. */
    milestones?: Milestone[];
  } = {},
): Promise<AnnualReviewQueue> {
  const milestones = options.milestones ?? [3, 6, 12, 18];
  const queues = await Promise.all(
    milestones.map((m) =>
      pendingAnnualReviews({
        ...options,
        milestone: m,
      }),
    ),
  );

  const entries = queues
    .flatMap((q) => q.entries)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const overdueCount = entries.filter((e) => e.daysUntil < 0).length;
  const dueThisWeek = entries.filter(
    (e) => e.daysUntil >= 0 && e.daysUntil <= 7,
  ).length;

  return { entries, overdueCount, dueThisWeek };
}

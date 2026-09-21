import type { Deal, StageId } from "./clients/salestrekker/types";
import { hasStageComms, stageCommsLabel } from "./stage-comms";

/**
 * Closed-loop milestone comms — the automation half of the milestone
 * emails. Instead of the broker remembering to open a deal and send the
 * congratulations / approval email, the system watches deal state and
 * queues the ones that are due, pre-drafted, for one-tap approval.
 *
 * Deliberately storage-light: the queue is DERIVED from current deal state
 * every time (so it's always correct with no background job), and the only
 * thing persisted is the send/dismiss decision — written to the audit
 * event log, which already exists. That event log is the "handled" set
 * that makes an item drop off and never nag again.
 */

/** Audit action written when a broker sends or dismisses a milestone comm. */
export const MILESTONE_COMM_ACTION = "milestone_comm.actioned";

/** Congrats + review email only stays timely for a couple of weeks. */
const SETTLED_WINDOW_DAYS = 14;

export interface MilestoneQueueItem {
  dealId: string;
  clientName: string;
  brokerId: string;
  stageId: StageId;
  /** Customer-facing milestone label, e.g. "Formal approval". */
  label: string;
  /** `${dealId}:${stageId}` — idempotency + "handled" key. */
  key: string;
  /** Calendar days the deal has sat at this milestone unactioned. */
  daysWaiting: number;
}

export function milestoneKey(dealId: string, stageId: string): string {
  return `${dealId}:${stageId}`;
}

/** Rank so the most time-sensitive goodwill (a fresh settlement) is first. */
const STAGE_ORDER: Record<string, number> = {
  settled: 0,
  "settle-booked": 1,
  "loan-docs": 2,
  unconditional: 3,
  "cond-approved": 4,
};

export function buildMilestoneQueue(
  deals: Deal[],
  handledKeys: Set<string>,
  now: Date = new Date(),
): MilestoneQueueItem[] {
  const items: MilestoneQueueItem[] = [];
  for (const deal of deals) {
    if (deal.nurturedAt !== null) continue;
    if (!hasStageComms(deal.stageId)) continue;

    // A settled deal keeps its stage forever, so only queue the congrats +
    // review email while it's still fresh; the run-to-settlement stages are
    // inherently current because the deal is sitting in them right now.
    if (deal.stageId === "settled") {
      if (!deal.settledOn) continue;
      const settled = new Date(deal.settledOn);
      if (Number.isNaN(settled.getTime())) continue;
      const ageDays = (now.getTime() - settled.getTime()) / 86_400_000;
      if (ageDays < 0 || ageDays > SETTLED_WINDOW_DAYS) continue;
    }

    const key = milestoneKey(deal.id, deal.stageId);
    if (handledKeys.has(key)) continue;

    const daysWaiting =
      deal.stageEnteredAt instanceof Date
        ? Math.max(0, Math.floor((now.getTime() - deal.stageEnteredAt.getTime()) / 86_400_000))
        : 0;

    items.push({
      dealId: deal.id,
      clientName: deal.name,
      brokerId: deal.brokerId,
      stageId: deal.stageId,
      label: stageCommsLabel(deal.stageId) ?? "",
      key,
      daysWaiting,
    });
  }

  // Freshest goodwill first (settled), then longest-waiting within a stage —
  // an approval that's been sitting for days is the one to send now.
  items.sort(
    (a, b) =>
      (STAGE_ORDER[a.stageId] ?? 9) - (STAGE_ORDER[b.stageId] ?? 9) ||
      b.daysWaiting - a.daysWaiting ||
      a.clientName.localeCompare(b.clientName),
  );
  return items;
}

/** Build the "handled" key set from milestone-comm audit events. */
export function handledKeysFromEvents(
  events: Array<{ dealId: string | null; meta: unknown }>,
): Set<string> {
  const set = new Set<string>();
  for (const e of events) {
    if (!e.dealId) continue;
    const stageId = (e.meta as { stageId?: string } | null)?.stageId;
    if (stageId) set.add(milestoneKey(e.dealId, stageId));
  }
  return set;
}

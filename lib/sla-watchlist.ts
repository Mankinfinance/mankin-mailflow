import type { Deal } from "./clients/salestrekker/types";
import { stageMeta } from "./clients/salestrekker/types";
import type { LenderSlaValues } from "./lenders";
import { slaStatusForDeal } from "./lender-sla";

/**
 * Live SLA watchlist — the in-app companion to the daily priority report.
 * For every active deal sitting in an SLA-governed stage, it works out
 * whether the wait has blown the lender's turnaround, is due today, or is
 * still on track, and buckets them most-urgent-first so the team can see
 * what to chase right now instead of waiting for the morning email.
 *
 * Pure over the deal list + SLA map, so it behaves the same on mock data
 * and the live Salestrekker feed.
 */

export type SlaUrgency = "overdue" | "due" | "on-track";

export interface SlaWatchItem {
  dealId: string;
  clientName: string;
  brokerId: string;
  lender: string;
  stageLabel: string;
  /** SLA segment name ("Assessment", "Formal approval", ...). */
  segmentLabel: string;
  expectedDays: number;
  daysInStage: number;
  overdueBy: number;
  urgency: SlaUrgency;
}

export interface SlaWatchlist {
  overdue: SlaWatchItem[];
  due: SlaWatchItem[];
  onTrack: SlaWatchItem[];
  counts: { overdue: number; due: number; onTrack: number; tracked: number };
}

/** Strip the "(proposed)" / "(chosen)" bookkeeping suffix for display. */
function displayLender(lender: string): string {
  return lender.replace(/\s*\((proposed|chosen)\)\s*/gi, "").trim() || "TBC";
}

export function buildSlaWatchlist(
  deals: Deal[],
  slaMap: Map<string, LenderSlaValues>,
  now: Date = new Date(),
): SlaWatchlist {
  const items: SlaWatchItem[] = [];

  for (const deal of deals) {
    // Active pipeline only — settled and parked deals aren't waiting on a lender.
    if (deal.stageId === "settled" || deal.nurturedAt !== null) continue;

    const status = slaStatusForDeal(deal, slaMap, now);
    // Needs a governed stage with a known turnaround and a measurable wait.
    if (
      status.key === null ||
      status.expectedDays === null ||
      status.daysInStage === null
    ) {
      continue;
    }

    const urgency: SlaUrgency = status.overdue
      ? "overdue"
      : status.daysInStage >= status.expectedDays
        ? "due"
        : "on-track";

    items.push({
      dealId: deal.id,
      clientName: deal.name,
      brokerId: deal.brokerId,
      lender: displayLender(deal.lender),
      stageLabel: stageMeta(deal.stageId).shortLabel,
      segmentLabel: status.label ?? "",
      expectedDays: status.expectedDays,
      daysInStage: status.daysInStage,
      overdueBy: status.overdueBy,
      urgency,
    });
  }

  const overdue = items
    .filter((i) => i.urgency === "overdue")
    .sort((a, b) => b.overdueBy - a.overdueBy || b.daysInStage - a.daysInStage);
  const due = items
    .filter((i) => i.urgency === "due")
    .sort((a, b) => b.daysInStage - a.daysInStage);
  const onTrack = items
    .filter((i) => i.urgency === "on-track")
    // Closest to their deadline first, so "watch these next" reads top-down.
    .sort((a, b) => b.daysInStage - b.expectedDays - (a.daysInStage - a.expectedDays));

  return {
    overdue,
    due,
    onTrack,
    counts: {
      overdue: overdue.length,
      due: due.length,
      onTrack: onTrack.length,
      tracked: items.length,
    },
  };
}

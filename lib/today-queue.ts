import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { scoreDeal } from "@/lib/risk-scoring";

/**
 * Today's queue — the prescriptive morning brief.
 *
 * Scans every open deal and produces a prioritised list of "you should
 * do this now" items. Each item carries enough info for the UI to render
 * a one-click action button (Send follow-up, Compose advisory, Confirm
 * settlement) that routes back into existing server actions.
 *
 * Three priority bands:
 *   • critical — drop-everything: settlement booked but unconfirmed,
 *     stage stalled >14d, overdue docs piling up, leaves unfilled.
 *   • important — work the morning around: follow-up overdue, customer
 *     just uploaded, advisory pending.
 *   • nice     — opportunistic touches: regular cadence, new leads.
 *
 * Ordering inside a band is by deal "heat" (days since contact descending,
 * advisory count descending). The UI groups by band so the broker reads
 * top-to-bottom.
 */

export type QueuePriority = "critical" | "important" | "nice";

export type QueueAction =
  | "send-followup"
  | "post-advisory"
  | "confirm-settlement"
  | "review-uploads"
  | "process-new-lead"
  | "risk-alert";

export interface QueueItem {
  /** Stable id so React keys cleanly: "dealId:action" */
  id: string;
  dealId: string;
  dealName: string;
  dealRef: string;
  /** Owner ids — used by the UI to render avatars + decide who's responsible */
  brokerId: string;
  associateId: string;
  priority: QueuePriority;
  action: QueueAction;
  /** Short imperative title that becomes the row's main line */
  title: string;
  /** One-line rationale (why this is here) shown under the title */
  reason: string;
  /** Sort score — higher = sooner; only used within a priority band */
  score: number;
  /** Risk level from scoreDeal — set on risk-alert items only */
  riskLevel?: string;
}

export interface TodayQueue {
  critical: QueueItem[];
  important: QueueItem[];
  nice: QueueItem[];
  /** Convenience: total count across bands */
  total: number;
  /** Just the critical band — drives the sidebar nav badge */
  criticalCount: number;
}

/**
 * Whether a deal is in an "actively working" stage. Settled deals
 * never appear on the queue; lender-side stages (B.2 / B.3) need
 * lower-touch monitoring.
 */
function isActivelyWorked(deal: Deal): boolean {
  if (deal.stageId === "settled") return false;
  // Nurtured deals are out of the today queue until the broker
  // explicitly returns them to active.
  if (deal.nurturedAt !== null) return false;
  return true;
}

function settlementDateFor(deal: Deal): Date | null {
  // deal.settlement is free-form like "14 Jul" / "TBD". Parse the
  // dd-mmm shape only — anything else is null. Year is current year,
  // rolling to next year if the date is in the past.
  if (!deal.settlement || deal.settlement === "TBD") return null;
  const match = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(deal.settlement.trim());
  if (!match) return null;
  const dayNum = parseInt(match[1], 10);
  const monthIdx = MONTH_INDEX[match[2].toLowerCase()];
  if (monthIdx === undefined) return null;
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, monthIdx, dayNum);
  // If the parsed date is more than a month behind, assume next year.
  if (candidate.getTime() < now.getTime() - 30 * 86400_000) {
    year += 1;
  }
  return new Date(year, monthIdx, dayNum);
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400_000);
}

interface BuildOpts {
  now?: Date;
}

/**
 * Classify each open deal into 0..N queue items. Pure function — easy
 * to unit-test as more rules get added.
 */
export function buildTodayQueue(deals: Deal[], opts: BuildOpts = {}): TodayQueue {
  const now = opts.now ?? new Date();
  const items: QueueItem[] = [];

  for (const deal of deals) {
    if (!isActivelyWorked(deal)) continue;

    /* ── Settlement window ─────────────────────────────────────── */
    const settles = settlementDateFor(deal);
    if (settles) {
      const daysToSettle = daysBetween(settles, now);
      if (deal.stageId === "settle-booked" && daysToSettle >= 0 && daysToSettle <= 7) {
        items.push({
          id: `${deal.id}:confirm-settlement`,
          dealId: deal.id,
          dealName: deal.name,
          dealRef: deal.appRef,
          brokerId: deal.brokerId,
          associateId: deal.associateId,
          priority: "critical",
          action: "confirm-settlement",
          title: `Confirm settlement · ${deal.settlement}`,
          reason:
            daysToSettle === 0
              ? "Settling today — confirm with conveyancer + lender solicitor"
              : `Settling in ${daysToSettle}d — confirm funds + conveyancer`,
          score: 1000 - daysToSettle * 10,
        });
      }
    }

    /* ── Overdue docs ──────────────────────────────────────────── */
    if (deal.overdue.length > 0) {
      const isCritical = deal.overdue.length >= 3 || deal.daysSinceContact >= 7;
      items.push({
        id: `${deal.id}:send-followup-overdue`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: isCritical ? "critical" : "important",
        action: "send-followup",
        title: `${deal.overdue.length} overdue ${deal.overdue.length === 1 ? "doc" : "docs"} — chase`,
        reason: `Last contact ${deal.daysSinceContact}d ago · pending: ${deal.overdue.slice(0, 3).join(", ")}${
          deal.overdue.length > 3 ? "…" : ""
        }`,
        score: 800 + deal.overdue.length * 20 + deal.daysSinceContact * 5,
      });
      continue; // overdue trumps general follow-up
    }

    /* ── Advisory notes pending ────────────────────────────────── */
    if (deal.advisory.length > 0) {
      items.push({
        id: `${deal.id}:post-advisory`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "important",
        action: "post-advisory",
        title: `${deal.advisory.length} advisory ${deal.advisory.length === 1 ? "note" : "notes"} to send`,
        reason: deal.advisory[0]?.note ?? "Custom note required",
        score: 600 + deal.advisory.length * 30,
      });
    }

    /* ── Recent customer uploads to review ─────────────────────── */
    // Heuristic: associate-owned deal in pre-lodge / lodged / cond-approved
    // with recently-received docs but still pending = customer's been active.
    if (
      (deal.stageId === "pre-lodge" || deal.stageId === "cond-approved") &&
      deal.received.length >= 3 &&
      deal.pending.length > 0 &&
      deal.daysSinceContact <= 3
    ) {
      items.push({
        id: `${deal.id}:review-uploads`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "important",
        action: "review-uploads",
        title: "Customer returned docs — review + progress",
        reason: `${deal.received.length} received · ${deal.pending.length} still pending — chase the gap`,
        score: 500 + deal.received.length * 5,
      });
    }

    /* ── Stage stalled ─────────────────────────────────────────── */
    if (deal.daysSinceContact >= 14 && deal.advisory.length === 0 && deal.overdue.length === 0) {
      items.push({
        id: `${deal.id}:send-followup-stalled`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "critical",
        action: "send-followup",
        title: `Stalled · ${deal.daysSinceContact}d no contact`,
        reason: `Deal sitting in ${deal.stageId.replace("-", " ")} — re-engage before it goes cold`,
        score: 700 + deal.daysSinceContact * 5,
      });
    }

    /* ── Regular cadence follow-up ─────────────────────────────── */
    if (deal.daysSinceContact >= 5 && deal.daysSinceContact < 14 && deal.overdue.length === 0) {
      items.push({
        id: `${deal.id}:send-followup-cadence`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "important",
        action: "send-followup",
        title: `Cadence check — ${deal.daysSinceContact}d since contact`,
        reason: "Time for a light-touch update",
        score: 300 + deal.daysSinceContact * 5,
      });
    }

    /* ── Brand-new lead with no docs received ──────────────────── */
    if (deal.received.length === 0 && deal.stageId === "pre-lodge") {
      items.push({
        id: `${deal.id}:process-new-lead`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "nice",
        action: "process-new-lead",
        title: "New lead — kick off doc collection",
        reason: "No docs received yet — send the privacy form + ID request",
        score: 200,
      });
    }

    /* ── Stage not moved in 21+ days ──────────────────────────────── */
    const stageAge = deal.stageEnteredAt instanceof Date
      ? daysBetween(now, deal.stageEnteredAt)
      : null;
    if (
      stageAge !== null &&
      stageAge >= 21 &&
      deal.daysSinceContact < 14 // don't duplicate when contact-stalled rule fires
    ) {
      items.push({
        id: `${deal.id}:stage-stalled`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: stageAge >= 42 ? "critical" : "important",
        action: "send-followup",
        title: `Stage stuck · ${stageAge}d in ${deal.stageId.replace(/-/g, " ")}`,
        reason: "Deal has not moved stage — check with lender or follow up with the applicant",
        score: 450 + stageAge * 4,
      });
    }

    /* ── Risk signals not covered by other rules ────────────────── */
    const risk = scoreDeal(deal, now);

    // Pre-approval expiry: no other rule surfaces this — always add it.
    const paSignal = risk.signals.find(
      (s) => s.id === "pa-expired" || s.id === "pa-expiring",
    );
    if (paSignal) {
      const paExpired = paSignal.id === "pa-expired";
      items.push({
        id: `${deal.id}:risk-alert-pa`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: paExpired ? "critical" : "important",
        action: "send-followup",
        title: paExpired
          ? "Pre-approval expired — renew now"
          : "Pre-approval expiring — start renewal",
        reason: paExpired
          ? "Email the customer to request renewal documents (payslips, bank statements, employment letter)"
          : "Pre-approval is expiring — email the customer now to gather renewal documents before it lapses",
        score: paSignal.points * 10,
        riskLevel: risk.level,
      });
    }

    // Settlement stage lag: settlement is imminent but deal isn't in settle-booked yet.
    const settleLagSignal = risk.signals.find((s) => s.id === "settle-imminent");
    if (settleLagSignal && deal.stageId !== "settle-booked") {
      items.push({
        id: `${deal.id}:risk-alert-settle`,
        dealId: deal.id,
        dealName: deal.name,
        dealRef: deal.appRef,
        brokerId: deal.brokerId,
        associateId: deal.associateId,
        priority: "critical",
        action: "risk-alert",
        title: settleLagSignal.label,
        reason: "Settlement is imminent but the deal is not yet in the settlement stage — escalate now",
        score: 950,
        riskLevel: risk.level,
      });
    }
  }

  // Sort within each band by score descending.
  const byPriority = (p: QueuePriority) =>
    items.filter((i) => i.priority === p).sort((a, b) => b.score - a.score);

  const critical = byPriority("critical");
  const important = byPriority("important");
  const nice = byPriority("nice");

  return {
    critical,
    important,
    nice,
    total: items.length,
    criticalCount: critical.length,
  };
}

/**
 * Variant that limits to a specific person (broker or associate) — used
 * if we add "Just my queue" toggle later. Currently every page renders
 * the full team queue.
 */
export function filterByMember(queue: TodayQueue, memberId: string): TodayQueue {
  const match = (i: QueueItem) =>
    i.brokerId === memberId || i.associateId === memberId;
  const critical = queue.critical.filter(match);
  const important = queue.important.filter(match);
  const nice = queue.nice.filter(match);
  return {
    critical,
    important,
    nice,
    total: critical.length + important.length + nice.length,
    criticalCount: critical.length,
  };
}

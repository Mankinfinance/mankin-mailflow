import type { Deal } from "./clients/salestrekker/types";
import { stageMeta } from "./clients/salestrekker/types";
import type { LenderSlaValues } from "./lenders";
import { buildSlaWatchlist } from "./sla-watchlist";
import { buildMilestoneQueue } from "./milestone-queue";
import { scoreDeal } from "./risk-scoring";

/**
 * Control tower — the one screen that tells you what needs attention right
 * now, and pages you rather than waiting to be checked. It doesn't compute
 * anything new: it composes the signals already built (SLA breaches,
 * risk scoring, stale deals, pending milestone comms, settlements landing)
 * into a single severity-ranked alert feed plus a health snapshot.
 *
 * Pure over deals + the lender SLA map + the milestone "handled" set, so
 * it's testable and behaves identically on mock and live data.
 */

export type Severity = "critical" | "warning" | "info";

export interface TowerAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
}

export interface TowerStats {
  openDeals: number;
  pipelineValue: number;
  settlingSoon: number;
  settlingValue: number;
  overdueSla: number;
  atRisk: number;
  staleDeals: number;
  pendingComms: number;
  preApprovalExpiring: number;
}

export interface ControlTower {
  alerts: TowerAlert[];
  stats: TowerStats;
}

const STALE_DAYS = 3;
const PREAPPROVAL_WINDOW_DAYS = 21;

function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - now.getTime()) / 86_400_000);
}

export function buildControlTower(
  deals: Deal[],
  slaMap: Map<string, LenderSlaValues>,
  milestoneHandledKeys: Set<string>,
  now: Date = new Date(),
): ControlTower {
  const active = deals.filter((d) => d.stageId !== "settled" && d.nurturedAt === null);

  const pipelineValue = active
    .filter((d) => stageMeta(d.stageId).phase >= 2)
    .reduce((s, d) => s + (d.loanAmount ?? 0), 0);

  const settlingDeals = active.filter(
    (d) => d.stageId === "loan-docs" || d.stageId === "settle-booked",
  );
  const settlingValue = settlingDeals.reduce((s, d) => s + (d.loanAmount ?? 0), 0);

  const sla = buildSlaWatchlist(deals, slaMap, now);

  let critical = 0;
  let high = 0;
  for (const d of active) {
    const level = scoreDeal(d).level;
    if (level === "critical") critical++;
    else if (level === "high") high++;
  }

  const staleDeals = active.filter((d) => d.daysSinceContact >= STALE_DAYS).length;

  const pendingComms = buildMilestoneQueue(deals, milestoneHandledKeys, now).length;

  const preApprovalExpiring = active.filter((d) => {
    const days = daysUntil(d.preApprovalExpiry, now);
    return days !== null && days <= PREAPPROVAL_WINDOW_DAYS;
  }).length;

  const stats: TowerStats = {
    openDeals: active.length,
    pipelineValue,
    settlingSoon: settlingDeals.length,
    settlingValue,
    overdueSla: sla.counts.overdue,
    atRisk: critical + high,
    staleDeals,
    pendingComms,
    preApprovalExpiring,
  };

  const alerts: TowerAlert[] = [];
  const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

  if (sla.counts.overdue > 0) {
    alerts.push({
      id: "sla-overdue",
      severity: "critical",
      title: `${plural(sla.counts.overdue, "deal")} past lender SLA`,
      detail: "A lender has blown its turnaround. Chase or escalate now.",
      href: "/dashboard/sla-watchlist",
    });
  }
  if (critical > 0) {
    alerts.push({
      id: "risk-critical",
      severity: "critical",
      title: `${plural(critical, "deal")} at critical risk`,
      detail: "Overdue docs or stalled deals that could fall over.",
      href: "/dashboard?risk=1",
    });
  }
  if (preApprovalExpiring > 0) {
    alerts.push({
      id: "preapproval",
      severity: "warning",
      title: `${plural(preApprovalExpiring, "pre-approval")} expiring soon`,
      detail: `Within ${PREAPPROVAL_WINDOW_DAYS} days — renew before they lapse.`,
      href: "/dashboard/today",
    });
  }
  if (sla.counts.due > 0) {
    alerts.push({
      id: "sla-due",
      severity: "warning",
      title: `${plural(sla.counts.due, "deal")} due on SLA today`,
      detail: "On the lender's deadline — a nudge keeps them moving.",
      href: "/dashboard/sla-watchlist",
    });
  }
  if (staleDeals > 0) {
    alerts.push({
      id: "stale",
      severity: "warning",
      title: `${plural(staleDeals, "deal")} gone quiet`,
      detail: `Not touched in ${STALE_DAYS}+ days. Run the follow-up cadence.`,
      href: "/dashboard/today",
    });
  }
  if (pendingComms > 0) {
    alerts.push({
      id: "milestone-comms",
      severity: "info",
      title: `${plural(pendingComms, "milestone email")} ready to send`,
      detail: "Approval and settlement emails drafted and waiting.",
      href: "/dashboard/milestone-comms",
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { alerts, stats };
}

import "server-only";
import type { Deal } from "./clients/salestrekker/types";
import {
  MANKIN_STAGES,
  mankinStageLabel,
  type MankinStage,
} from "./clients/salestrekker/types";
import { TEAM, type TeamMember } from "./team";

/**
 * Computation helpers for the Overview page, which mirrors the
 * "Dashboard" sheet in the existing Mankin Finance Pipeline Dashboard
 * spreadsheet. Every section returns a serialisable shape the server
 * page can render directly.
 *
 * Stages used by the breakdowns are the Mankin pipeline labels
 * (Awaiting Documents, Workshopping, etc.) — not the internal B.1-B.7
 * ids — because that's how the broker team thinks and reports.
 */

/* -------------------------------------------------------------------------- */
/* Stage status table                                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Outstanding Action" and "Follow up" appear in the broker's source
 * sheet as if they were stages, but architecturally we treat them as
 * priority flags overlaid on the real stage (matches Q1's choice in
 * the AskUserQuestion confirmation). We surface them here so the
 * Overview shows the same row layout as the original spreadsheet.
 */
export const OVERVIEW_ROWS: ReadonlyArray<{
  key: MankinStage | "Outstanding Action" | "Follow up";
  isFlag: boolean;
}> = [
  ...MANKIN_STAGES.map((s) => ({ key: s, isFlag: false })),
  { key: "Outstanding Action" as const, isFlag: true },
  { key: "Follow up" as const, isFlag: true },
];

export interface StageStatusRow {
  label: string;
  /** Current count (this week). */
  current: number;
  /** Count from the previous-week snapshot; null until snapshots run. */
  previous: number | null;
  change: number | null;
}

/** Row-label -> current deal count, keyed exactly as the overview rows
 *  (Mankin stage names plus the two priority flags). The snapshot cron
 *  persists this map each day so a later render can diff against it. */
export function stageCounts(deals: Deal[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of OVERVIEW_ROWS) {
    out[row.key] = row.isFlag
      ? deals.filter(
          (d) =>
            d.priorityFlag ===
            (row.key === "Outstanding Action" ? "outstanding-action" : "follow-up"),
        ).length
      : deals.filter((d) => mankinStageLabel(d) === row.key).length;
  }
  return out;
}

/** Pure function so /reports + /dashboard/overview can share it.
 *  Counts deals by Mankin stage; rows for the two priority flags use
 *  the count of deals carrying that flag.
 *
 *  `previous` is the counts map from a prior snapshot (~7 days ago). When
 *  supplied, each row gets a real previous count + week-on-week change;
 *  when null (no snapshot history yet) both render as "—" rather than
 *  mislead with synthetic numbers. */
export function stageStatus(
  deals: Deal[],
  previous?: Record<string, number> | null,
): StageStatusRow[] {
  const current = stageCounts(deals);
  return OVERVIEW_ROWS.map((row) => {
    const count = current[row.key];
    const prev =
      previous && typeof previous[row.key] === "number"
        ? previous[row.key]
        : null;
    return {
      label: row.key,
      current: count,
      previous: prev,
      change: prev === null ? null : count - prev,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Loan type split                                                             */
/* -------------------------------------------------------------------------- */

const LOAN_TYPES: ReadonlyArray<Deal["leadCategory"]> = [
  "purchase",
  "refinance",
  "smsf",
  "construction",
  "business",
  "asset",
  "unknown",
];

export interface LoanTypeRow {
  label: string;
  current: number;
  previous: number | null;
}

const LEAD_CATEGORY_LABEL: Record<Deal["leadCategory"], string> = {
  purchase: "Purchase",
  refinance: "Refinance",
  smsf: "SMSF",
  construction: "Construction",
  business: "Business",
  asset: "Asset",
  settled: "Settled",
  unknown: "Other",
};

export function loanTypeSplit(deals: Deal[]): LoanTypeRow[] {
  return LOAN_TYPES.map((cat) => ({
    label: LEAD_CATEGORY_LABEL[cat],
    current: deals.filter((d) => d.leadCategory === cat).length,
    previous: null,
  })).filter((row) => row.current > 0);
}

/* -------------------------------------------------------------------------- */
/* Source breakdown                                                            */
/* -------------------------------------------------------------------------- */

export interface SourceRow {
  source: string;
  current: number;
}

/** Group deals by lead source label. Empty strings collapse into "(blank)".
 *  Sort by current descending so the top contributors lead the table. */
export function sourceBreakdown(deals: Deal[]): SourceRow[] {
  const totals = new Map<string, number>();
  for (const d of deals) {
    const src = d.leadSource?.trim() || "(blank)";
    totals.set(src, (totals.get(src) ?? 0) + 1);
  }
  return [...totals.entries()]
    .map(([source, current]) => ({ source, current }))
    .sort((a, b) => b.current - a.current);
}

/* -------------------------------------------------------------------------- */
/* Owners breakdown                                                            */
/* -------------------------------------------------------------------------- */

export interface OwnerRow {
  ownerLabel: string;
  /** Counts keyed by Mankin stage label or flag. */
  byStage: Record<string, number>;
  total: number;
}

/** Per-owner stage breakdown matching the bottom of the original
 *  Dashboard sheet (Michael, Maddison, Nathan, Robert, Loan Support,
 *  Nurture). Nurture is a row, not a real broker — it counts deals
 *  parked via the nurture feature regardless of original owner. */
export function ownerBreakdown(deals: Deal[], team: readonly TeamMember[]): OwnerRow[] {
  const rows: OwnerRow[] = [];

  // Real brokers first.
  for (const m of team) {
    const owned = deals.filter(
      (d) => d.brokerId === m.id && d.nurturedAt === null,
    );
    if (owned.length === 0) continue;
    const byStage: Record<string, number> = {};
    let total = 0;
    for (const d of owned) {
      const label = mankinStageLabel(d);
      byStage[label] = (byStage[label] ?? 0) + 1;
      total += 1;
    }
    // Also count the flags so each owner column matches the broker's sheet.
    for (const d of owned) {
      if (d.priorityFlag === "outstanding-action") {
        byStage["Outstanding Action"] = (byStage["Outstanding Action"] ?? 0) + 1;
      }
      if (d.priorityFlag === "follow-up") {
        byStage["Follow up"] = (byStage["Follow up"] ?? 0) + 1;
      }
    }
    rows.push({ ownerLabel: m.short, byStage, total });
  }

  // Nurture row aggregates every nurtured deal across all brokers.
  const nurtured = deals.filter((d) => d.nurturedAt !== null);
  if (nurtured.length > 0) {
    const byStage: Record<string, number> = {};
    for (const d of nurtured) {
      const label = mankinStageLabel(d);
      byStage[label] = (byStage[label] ?? 0) + 1;
    }
    rows.push({
      ownerLabel: "Nurture",
      byStage,
      total: nurtured.length,
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* YTD totals                                                                  */
/* -------------------------------------------------------------------------- */

export interface YtdSummary {
  loanCount: number;
  loanValue: number;
  byOwner: Array<{ ownerLabel: string; count: number; value: number }>;
}

/** Year-to-date settled summary across the deal set. Uses the calendar
 *  year from the supplied "now" (defaults to today). */
export function ytdSummary(
  deals: Deal[],
  team: readonly TeamMember[],
  now: Date = new Date(),
): YtdSummary {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const settled = deals.filter(
    (d) =>
      d.stageId === "settled" &&
      d.settledOn !== null &&
      new Date(d.settledOn).getTime() >= yearStart,
  );

  let loanValue = 0;
  for (const d of settled) loanValue += d.loanAmount ?? 0;

  const byOwner = team
    .map((m) => {
      const owned = settled.filter((d) => d.brokerId === m.id);
      return {
        ownerLabel: m.short,
        count: owned.length,
        value: owned.reduce((sum, d) => sum + (d.loanAmount ?? 0), 0),
      };
    })
    .filter((row) => row.count > 0);

  return { loanCount: settled.length, loanValue, byOwner };
}

/* -------------------------------------------------------------------------- */
/* Upcoming settlements                                                        */
/* -------------------------------------------------------------------------- */

export interface UpcomingSettlement {
  dealId: string;
  name: string;
  loanAmount: number | null;
  leadSource: string;
  ownerLabel: string;
  /** ISO date of the booked settlement, or null when unknown. */
  date: string | null;
  /** Free-form display from the original sheet (e.g. "14 Jul", "TBD"). */
  display: string;
}

/** Resolve "next 60 days" of upcoming settlements (settle-booked or
 *  loan-docs in our stage model; the broker sheet lumps these into
 *  "Awaiting Settlement"). */
export function upcomingSettlements(
  deals: Deal[],
  team: readonly TeamMember[],
): UpcomingSettlement[] {
  const upcoming = deals
    .filter(
      (d) =>
        (d.stageId === "settle-booked" || d.stageId === "loan-docs") &&
        d.nurturedAt === null,
    )
    .map((d) => {
      const owner = team.find((m) => m.id === d.brokerId);
      return {
        dealId: d.id,
        name: d.name,
        loanAmount: d.loanAmount,
        leadSource: d.leadSource || "",
        ownerLabel: owner?.short ?? d.brokerId,
        date: null as string | null,
        display: d.settlement || "TBD",
      };
    });
  return upcoming;
}

/* -------------------------------------------------------------------------- */
/* Currency formatter                                                          */
/* -------------------------------------------------------------------------- */

export function fmtAud(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000).toLocaleString()}k`;
  }
  return `$${Math.round(amount).toLocaleString()}`;
}

/** Convenience: bundle every section so the page can fetch in one call. */
export interface OverviewData {
  stageStatus: StageStatusRow[];
  loanTypeSplit: LoanTypeRow[];
  sourceBreakdown: SourceRow[];
  ownerBreakdown: OwnerRow[];
  ytdSummary: YtdSummary;
  upcomingSettlements: UpcomingSettlement[];
  generatedAt: string;
  totalDeals: number;
  totalActive: number;
  totalNurtured: number;
  totalSettled: number;
}

export function buildOverview(
  deals: Deal[],
  opts?: { previousStageCounts?: Record<string, number> | null },
): OverviewData {
  return {
    stageStatus: stageStatus(deals, opts?.previousStageCounts ?? null),
    loanTypeSplit: loanTypeSplit(deals),
    sourceBreakdown: sourceBreakdown(deals),
    ownerBreakdown: ownerBreakdown(deals, TEAM),
    ytdSummary: ytdSummary(deals, TEAM),
    upcomingSettlements: upcomingSettlements(deals, TEAM),
    generatedAt: new Date().toISOString(),
    totalDeals: deals.length,
    totalActive: deals.filter(
      (d) => d.stageId !== "settled" && d.nurturedAt === null,
    ).length,
    totalNurtured: deals.filter((d) => d.nurturedAt !== null).length,
    totalSettled: deals.filter((d) => d.stageId === "settled").length,
  };
}

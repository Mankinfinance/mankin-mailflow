import type { Deal, StageId } from "@/lib/clients/salestrekker/types";
import { formatTimestampAU } from "@/lib/format-date";

/**
 * Settlements forecast — projects the next 30 / 60 / 90 days of
 * settled value from the current pipeline.
 *
 * Pure functions, server-and-client safe. No external calls.
 *
 * Two inputs combine per deal:
 *   1. expected settlement date — uses the broker-set settlement field
 *      (parsed "06 Jun" / "21 Jul" etc.) when available; otherwise
 *      derived from stage via STAGE_DAYS_TO_SETTLE.
 *   2. confidence — probability the deal actually settles, by stage.
 *      B.6 Settlement Booked is almost certain (99%); B.1 still has
 *      drop-off risk (60%). Numbers err on the conservative side.
 *
 * Per-deal expected value = loanAmount × confidence. Bucketed totals
 * sum the probability-weighted values within the date window.
 */

/* -------------------------------------------------------------------------- */
/* Per-stage tuning                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Days from today to expected settlement, by stage. Used only when the
 * deal doesn't have a concrete settlement date (e.g. "TBD"). Real
 * settlements live on the deal.settlement string.
 *
 * These map to Mankin's typical timeline — B.1 takes ~6 weeks to lodge,
 * the lender takes ~3 weeks for conditional, conditional → unconditional
 * is ~2-3 weeks, loan docs + booking is ~2 weeks more.
 */
const STAGE_DAYS_TO_SETTLE: Record<StageId, number> = {
  "pre-lodge":     45,
  lodged:          30,
  "cond-approved": 21,
  "pre-approval":  60, // house-hunting can drag on
  unconditional:   14,
  "loan-docs":     10,
  "settle-booked":  3,
  settled:          0,
};

/**
 * Probability the deal settles (vs drops, refinances elsewhere, or
 * stalls past 90 days). Higher confidence as the deal advances.
 * Used to discount the loanAmount when projecting aggregate value.
 */
const STAGE_CONVERSION: Record<StageId, number> = {
  "pre-lodge":     0.60,
  lodged:          0.80,
  "cond-approved": 0.90,
  "pre-approval":  0.50, // pre-approval w/o a contract is high drop risk
  unconditional:   0.95,
  "loan-docs":     0.97,
  "settle-booked": 0.99,
  settled:         1.00,
};

/** Human-readable confidence label for the projection table */
function confidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/* -------------------------------------------------------------------------- */
/* Settlement date parsing                                                    */
/* -------------------------------------------------------------------------- */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse the deal.settlement free-form string ("06 Jun" / "21 Jul").
 * Returns null when the value is TBD / blank / unparseable. Year
 * defaults to current; if the parsed date is more than a month behind,
 * we assume next year (handles December → January wrap-around cleanly).
 */
function parseSettlementString(raw: string | undefined, now: Date): Date | null {
  if (!raw || raw === "TBD") return null;
  const match = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(raw.trim());
  if (!match) return null;
  const dayNum = parseInt(match[1], 10);
  const monthIdx = MONTH_INDEX[match[2].toLowerCase()];
  if (monthIdx === undefined) return null;
  let year = now.getFullYear();
  const candidate = new Date(year, monthIdx, dayNum);
  if (candidate.getTime() < now.getTime() - 30 * 86400_000) {
    year += 1;
  }
  return new Date(year, monthIdx, dayNum);
}

function daysFromNow(date: Date, now: Date): number {
  return Math.round((date.getTime() - now.getTime()) / 86400_000);
}

/* -------------------------------------------------------------------------- */
/* Per-deal projection                                                        */
/* -------------------------------------------------------------------------- */

export interface ProjectedDeal {
  dealId: string;
  appRef: string;
  name: string;
  stageId: StageId;
  brokerId: string;
  /** Calendar date the deal is expected to settle. */
  expectedDate: Date;
  /** Days from today to expectedDate. */
  daysOut: number;
  /** 0..1 probability the deal actually settles. */
  confidence: number;
  /** "high" | "medium" | "low" label derived from confidence. */
  confidenceTier: "high" | "medium" | "low";
  /** loanAmount × confidence. 0 if loanAmount is null. */
  expectedValue: number;
  /** Whether the date came from deal.settlement (true) vs stage default (false). */
  dateFromExplicitSettlement: boolean;
}

export function projectDeal(deal: Deal, now: Date = new Date()): ProjectedDeal | null {
  if (deal.stageId === "settled") return null;

  const explicit = parseSettlementString(deal.settlement, now);
  const fallbackDays = STAGE_DAYS_TO_SETTLE[deal.stageId] ?? 30;
  const fallbackDate = new Date(now);
  fallbackDate.setDate(fallbackDate.getDate() + fallbackDays);

  const expectedDate = explicit ?? fallbackDate;
  const confidence = STAGE_CONVERSION[deal.stageId] ?? 0.5;
  const loanAmount = deal.loanAmount ?? 0;
  const expectedValue = Math.round(loanAmount * confidence);

  return {
    dealId: deal.id,
    appRef: deal.appRef,
    name: deal.name,
    stageId: deal.stageId,
    brokerId: deal.brokerId,
    expectedDate,
    daysOut: daysFromNow(expectedDate, now),
    confidence,
    confidenceTier: confidenceTier(confidence),
    expectedValue,
    dateFromExplicitSettlement: explicit !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregate forecast                                                         */
/* -------------------------------------------------------------------------- */

export interface ForecastBucket {
  /** Inclusive lower bound (start of the bucket). */
  start: Date;
  /** Exclusive upper bound (start of the next bucket). */
  end: Date;
  /** Compact label like "Jun 2026" / "Next 30 days". */
  label: string;
  /** Sum of expectedValue for deals settling within this window. */
  expectedValue: number;
  /** Number of deals contributing. */
  dealCount: number;
}

export interface ForecastSummary {
  /** All projected deals, sorted by date ascending. */
  deals: ProjectedDeal[];
  /** 30/60/90 day rolling buckets (overlapping). */
  next30: ForecastBucket;
  next60: ForecastBucket;
  next90: ForecastBucket;
  /** Calendar-month buckets (non-overlapping) for the next 4 months. */
  months: ForecastBucket[];
  /** Sum across all projected deals — total expected book value. */
  totalExpectedValue: number;
}

/**
 * Build the full settlements forecast from the current pipeline.
 * The `now` parameter is exposed for testing.
 */
export function buildForecast(args: {
  deals: Deal[];
  now?: Date;
}): ForecastSummary {
  const now = args.now ?? new Date();

  const projected: ProjectedDeal[] = [];
  for (const deal of args.deals) {
    const p = projectDeal(deal, now);
    if (p) projected.push(p);
  }
  projected.sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime());

  /* Rolling windows — easier to reason about than calendar buckets when
     the user asks "what's settling between now and end of June?" */
  const next30Date = addDays(now, 30);
  const next60Date = addDays(now, 60);
  const next90Date = addDays(now, 90);

  const next30 = bucketFor(projected, now, next30Date, "Next 30 days");
  const next60 = bucketFor(projected, now, next60Date, "Next 60 days");
  const next90 = bucketFor(projected, now, next90Date, "Next 90 days");

  /* Calendar months — non-overlapping, used for the bar chart. */
  const months: ForecastBucket[] = [];
  for (let i = 0; i < 4; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = start.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
    months.push(bucketFor(projected, start, end, label));
  }

  const totalExpectedValue = projected.reduce(
    (sum, p) => sum + p.expectedValue,
    0,
  );

  return {
    deals: projected,
    next30,
    next60,
    next90,
    months,
    totalExpectedValue,
  };
}

function bucketFor(
  projected: ProjectedDeal[],
  start: Date,
  end: Date,
  label: string,
): ForecastBucket {
  let expectedValue = 0;
  let dealCount = 0;
  for (const p of projected) {
    const t = p.expectedDate.getTime();
    if (t >= start.getTime() && t < end.getTime()) {
      expectedValue += p.expectedValue;
      dealCount += 1;
    }
  }
  return { start, end, label, expectedValue, dealCount };
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                            */
/* -------------------------------------------------------------------------- */

export function formatExpectedDate(date: Date): string {
  return formatTimestampAU(date);
}

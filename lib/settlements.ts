import type { SettlementRow } from "./commission-parser";

/**
 * Settlement anniversary logic — the rhythm the CX manager runs the
 * back-book on. Mankin's review touchpoints land at the 3, 6, 12, 18,
 * and 24-month marks after the loan settles. Each one triggers a
 * different conversation:
 *
 *   - 3 mo  → "settling in" check, first repayments hit
 *   - 6 mo  → are you using your offset right? any pain points?
 *   - 12 mo → annual review, fixed-rate watch, refinance scan
 *   - 18 mo → mid-cycle catch-up, market update
 *   - 24 mo → re-pricing review, lender retention, possible refi
 *
 * Pure functions — no DB / API calls. Feed in the settlement list,
 * get back which loans need attention this week / this month.
 */

export type AnniversaryMonths = 3 | 6 | 12 | 18 | 24;

export const ANNIVERSARY_MILESTONES: AnniversaryMonths[] = [3, 6, 12, 18, 24];

export interface AnniversaryHit {
  settlement: SettlementRow;
  /** Which milestone this hit belongs to (3, 6, 12, 18 or 24 months). */
  milestone: AnniversaryMonths;
  /** ISO date the milestone falls on this year. */
  milestoneDate: string;
  /** Days until milestoneDate. Negative = already passed, 0 = today. */
  daysUntil: number;
  /** Anniversary year (e.g. 1 = "1-year anniversary"). */
  yearsSinceSettlement: number;
}

export interface AnniversarySummary {
  /** Total active back-book loans. */
  totalActive: number;
  /** Loans by status. */
  byStatus: { active: number; closed: number; discharged: number; unknown: number };
  /** Hits per milestone in the next 30 days. */
  upcoming30d: Record<AnniversaryMonths, AnniversaryHit[]>;
  /** Hits per milestone in the next 90 days. */
  upcoming90d: Record<AnniversaryMonths, AnniversaryHit[]>;
  /** Aggregate book value figures. */
  bookValue: {
    totalSettlementValue: number;
    totalCurrentBalance: number;
    monthlyTrail: number;
    avgLoanSize: number;
  };
}

/**
 * Days from `today` until the next occurrence of `targetMonthDay`.
 * Negative when the date has already passed this year.
 */
function daysUntilNextDate(target: Date, today: Date): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const m = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((m.getTime() - t.getTime()) / 86400000);
}

/**
 * Find every anniversary hit on a single loan that falls within a
 * lookahead window measured in days. Returns 0..N entries — a loan
 * can hit two milestones in one window (rare but real, e.g. a 12mo
 * and 18mo loan both reviewed in the same 90-day sweep).
 */
export function anniversaryHitsForSettlement(
  s: SettlementRow,
  opts: { today: Date; lookaheadDays: number; backlogDays?: number },
): AnniversaryHit[] {
  if (s.loanStatus !== "active") return [];
  if (!s.settlementDate) return [];
  const settledAt = new Date(s.settlementDate);
  if (Number.isNaN(settledAt.getTime())) return [];

  const out: AnniversaryHit[] = [];
  const backlogDays = opts.backlogDays ?? 0;

  for (const months of ANNIVERSARY_MILESTONES) {
    const milestone = new Date(settledAt);
    milestone.setMonth(milestone.getMonth() + months);
    const daysUntil = daysUntilNextDate(milestone, opts.today);
    if (daysUntil <= opts.lookaheadDays && daysUntil >= -backlogDays) {
      out.push({
        settlement: s,
        milestone: months,
        milestoneDate: milestone.toISOString().slice(0, 10),
        daysUntil,
        yearsSinceSettlement: Math.floor(months / 12),
      });
    }
  }
  return out;
}

export function summariseBackbook(
  settlements: SettlementRow[],
  today: Date = new Date(),
): AnniversarySummary {
  const byStatus = { active: 0, closed: 0, discharged: 0, unknown: 0 };
  let totalSettlementValue = 0;
  let totalCurrentBalance = 0;
  let monthlyTrail = 0;
  for (const s of settlements) {
    byStatus[s.loanStatus]++;
    if (s.loanStatus === "active") {
      totalSettlementValue += s.settlementAmount;
      totalCurrentBalance += s.currentBalance;
      monthlyTrail += s.monthlyTrail;
    }
  }
  const totalActive = byStatus.active;
  const avgLoanSize = totalActive > 0 ? Math.round(totalCurrentBalance / totalActive) : 0;

  const empty = (): Record<AnniversaryMonths, AnniversaryHit[]> => ({
    3: [],
    6: [],
    12: [],
    18: [],
    24: [],
  });

  const upcoming30d = empty();
  const upcoming90d = empty();

  for (const s of settlements) {
    const hits90 = anniversaryHitsForSettlement(s, {
      today,
      lookaheadDays: 90,
      backlogDays: 14,
    });
    for (const h of hits90) {
      upcoming90d[h.milestone].push(h);
      if (h.daysUntil <= 30) upcoming30d[h.milestone].push(h);
    }
  }

  // Sort each cohort by days-until ascending so the broker hits the
  // most urgent first.
  for (const ms of ANNIVERSARY_MILESTONES) {
    upcoming30d[ms].sort((a, b) => a.daysUntil - b.daysUntil);
    upcoming90d[ms].sort((a, b) => a.daysUntil - b.daysUntil);
  }

  return {
    totalActive,
    byStatus,
    upcoming30d,
    upcoming90d,
    bookValue: {
      totalSettlementValue,
      totalCurrentBalance,
      monthlyTrail,
      avgLoanSize,
    },
  };
}

/** Friendly label for an anniversary milestone — used in UI + emails. */
export function milestoneLabel(months: AnniversaryMonths): string {
  if (months === 3) return "3-month settling-in check";
  if (months === 6) return "6-month review";
  if (months === 12) return "1-year annual review";
  if (months === 18) return "18-month mid-cycle catch-up";
  return "2-year repricing review";
}

/* -------------------------------------------------------------------------- */
/* Refinance risk score                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic 0-100 refinance opportunity score per loan. Higher = more
 * likely to benefit from a rate-positioning conversation or refi.
 *
 * Today the YBR commission XLSX doesn't carry the current interest rate
 * or the fixed-rate expiry, so the score is built from proxies we have:
 *
 *   tenureScore   (0-40)  → older loans drift higher off the current
 *                            best-rate by ~0.05% per month after 12mo
 *   lenderScore   (0-25)  → some lenders are notorious for retaining
 *                            customers on stale rates after honeymoon
 *                            (Big 4 + St George cluster); broker-direct
 *                            channels (Macquarie, ME, neo-banks) tend
 *                            to track market
 *   equityScore   (0-20)  → principal paid down vs settlement = more
 *                            equity = more lender options at refi
 *   sizeScore     (0-15)  → bigger balance = bigger absolute saving
 *                            from a 0.3% rate drop = easier conversation
 *
 * When you start importing interest rates + fixed-term expiries, replace
 * tenureScore with a real "rate vs market" comparison + add an expiry
 * urgency component. Until then the heuristic is good enough to surface
 * the right 20% of the back-book for retention calls.
 */

export type RiskTier = "high" | "medium" | "low" | "minimal";

export interface RefinanceRisk {
  /** 0-100, higher = more likely to refi-save */
  score: number;
  tier: RiskTier;
  /** Plain-English reasons feeding the score — shown on the row hover */
  reasons: string[];
  /** Component breakdown for debugging + audit */
  components: {
    tenure: number;
    lender: number;
    equity: number;
    size: number;
  };
}

/** Lender retention reputation. 0 = tracks market closely; 25 = notorious
 *  rate-creep after honeymoon. Calibrate from actual outcomes over time. */
const LENDER_RATE_CREEP: Record<string, number> = {
  // Big 4 + offshoots — known to creep above market without prompting
  cba: 22,
  "commonwealth bank": 22,
  westpac: 22,
  anz: 20,
  nab: 20,
  "st george": 20,
  "bank of melbourne": 20,
  "bank sa": 20,
  // Major regionals — moderate creep
  bankwest: 16,
  "ing bank": 14,
  ing: 14,
  suncorp: 16,
  bendigo: 15,
  "bendigo bank": 15,
  // Customer-owned / broker-direct — typically rate-track market
  macquarie: 6,
  "macquarie bank": 6,
  me: 10,
  "me bank": 10,
  bankofqueensland: 14,
  // Non-banks / online — usually competitive
  pepper: 8,
  resimac: 8,
  firstmac: 8,
  "hemisphere - resimac": 8,
  "resi wholesale funding": 8,
  athena: 4,
  ubank: 5,
  allianz: 8,
  ahl: 12,
};

function lenderCreepFor(name: string): number {
  if (!name) return 12; // unknown → assume moderate
  const k = name.toLowerCase().trim();
  if (k in LENDER_RATE_CREEP) return LENDER_RATE_CREEP[k];
  // Substring match for common prefixes
  for (const [key, v] of Object.entries(LENDER_RATE_CREEP)) {
    if (k.includes(key)) return v;
  }
  return 12; // default mid-range
}

export function computeRefinanceRisk(args: {
  settlementDate: string;
  settlementAmount: number;
  currentBalance: number;
  lender: string;
  loanStatus: string;
  today?: Date;
}): RefinanceRisk {
  const reasons: string[] = [];

  // Closed / discharged loans are off the back-book; score 0.
  if (args.loanStatus !== "active") {
    return {
      score: 0,
      tier: "minimal",
      reasons: ["Not active on back-book"],
      components: { tenure: 0, lender: 0, equity: 0, size: 0 },
    };
  }

  const today = args.today ?? new Date();
  const settled = new Date(args.settlementDate);
  if (Number.isNaN(settled.getTime())) {
    return {
      score: 0,
      tier: "minimal",
      reasons: ["Unknown settlement date"],
      components: { tenure: 0, lender: 0, equity: 0, size: 0 },
    };
  }

  // tenure score 0-40 — ramps from 0 at settlement to 40 at 30+ months
  const monthsSinceSettlement =
    (today.getFullYear() - settled.getFullYear()) * 12 +
    (today.getMonth() - settled.getMonth());
  let tenure = 0;
  if (monthsSinceSettlement < 6) {
    tenure = 0;
    reasons.push("Honeymoon period: too early to refi");
  } else if (monthsSinceSettlement < 12) {
    tenure = Math.round((monthsSinceSettlement - 6) * 2); // 0→12
    reasons.push("Settled <1 year ago, light rate creep risk");
  } else if (monthsSinceSettlement < 18) {
    tenure = Math.round(12 + (monthsSinceSettlement - 12) * 2); // 12→24
    reasons.push(`${monthsSinceSettlement}mo since settlement, rate likely drifting`);
  } else if (monthsSinceSettlement < 30) {
    tenure = Math.round(24 + (monthsSinceSettlement - 18) * 1.5); // 24→42
    reasons.push(`${monthsSinceSettlement}mo since settlement, strong refi candidate`);
  } else {
    tenure = 40;
    reasons.push(`Settled ${Math.floor(monthsSinceSettlement / 12)}+ years ago, high refi opportunity`);
  }
  tenure = Math.min(40, Math.max(0, tenure));

  // lender score 0-25
  const lender = lenderCreepFor(args.lender);
  if (lender >= 18) {
    reasons.push(`${args.lender} known for rate creep after honeymoon`);
  } else if (lender <= 8) {
    reasons.push(`${args.lender} typically tracks market, lower refi upside`);
  }

  // equity score 0-20 — principal paid down vs settlement amount
  let equity = 0;
  if (args.settlementAmount > 0 && args.currentBalance > 0) {
    const paidDownRatio =
      Math.max(0, args.settlementAmount - args.currentBalance) /
      args.settlementAmount;
    equity = Math.round(paidDownRatio * 40); // 50% paid down = 20
    if (equity >= 15) {
      reasons.push(`${Math.round(paidDownRatio * 100)}% paid down: equity unlocked for refi`);
    } else if (equity >= 8) {
      reasons.push(`${Math.round(paidDownRatio * 100)}% paid down: some equity available`);
    }
  }
  equity = Math.min(20, equity);

  // size score 0-15 — bigger balance = bigger absolute saving
  let size = 0;
  if (args.currentBalance >= 1_000_000) {
    size = 15;
    reasons.push("$1M+ balance: meaningful $ saving from 0.3% rate drop");
  } else if (args.currentBalance >= 600_000) {
    size = 12;
    reasons.push("$600k+ balance: material refi saving potential");
  } else if (args.currentBalance >= 350_000) {
    size = 8;
  } else if (args.currentBalance >= 150_000) {
    size = 4;
  } else {
    size = 1;
  }

  const score = Math.min(100, tenure + lender + equity + size);
  let tier: RiskTier;
  if (score >= 70) tier = "high";
  else if (score >= 45) tier = "medium";
  else if (score >= 20) tier = "low";
  else tier = "minimal";

  return {
    score,
    tier,
    reasons,
    components: { tenure, lender, equity, size },
  };
}

/** Convenience: compute risk for a SettlementRow without re-spelling fields. */
export function riskForSettlement(s: SettlementRow, today?: Date): RefinanceRisk {
  return computeRefinanceRisk({
    settlementDate: s.settlementDate,
    settlementAmount: s.settlementAmount,
    currentBalance: s.currentBalance,
    lender: s.lender,
    loanStatus: s.loanStatus,
    today,
  });
}

/* -------------------------------------------------------------------------- */
/* Anniversary talking points                                                  */
/* -------------------------------------------------------------------------- */

/** Suggested talking points for each milestone. Feeds the email draft.
 *  Every line is a concrete value-add Mankin can offer at this stage,
 *  not a vague check-in. Plain Australian English, no em dashes. */
export function milestoneTalkingPoints(months: AnniversaryMonths): string[] {
  switch (months) {
    case 3:
      return [
        "First repayments: confirming everything's direct-debiting cleanly.",
        "Any surprises in the loan documents you'd like clarified?",
        "Offset account set up the way you want it?",
        "Council rates notice and home insurance on file with the lender.",
      ];
    case 6:
      return [
        "Quick offset-account check: is your salary landing in there?",
        "Any change in employment, income, or circumstances?",
        "How's the property: any work or renovations planned?",
        "Free rate-positioning check vs the current market.",
      ];
    case 12:
      return [
        "Annual review: a comprehensive look at where the loan sits today.",
        "Order a valuation on the property so we know your current equity.",
        "Reprice request to your current lender on your behalf, no cost to you.",
        "Market scan across every lender we deal with for a better deal.",
        "If on a fixed rate, plan the rollover well before expiry.",
        "Equity unlock options for an investment property, renovation, or topping up the offset.",
        "If you know anyone looking at buying or refinancing, send them our way. Mankin grows because of clients like you.",
      ];
    case 18:
      return [
        "Mid-cycle catch-up: anything changed in life, work, or finances?",
        "Quick rate vs market check across our lender panel.",
        "Any property changes, renovations, or new goals on the horizon?",
        "Refer-a-friend reminder: we're never too busy for a great client.",
      ];
    case 24:
      return [
        "Re-pricing review: we'll request a sharper rate from your current lender.",
        "Run the refinance numbers if the lender won't budge.",
        "Order a valuation to confirm your latest equity position.",
        "Look at fixed vs variable mix vs the current rate outlook.",
        "Any equity to release for investment, renovation, or paying down other debt?",
      ];
  }
}

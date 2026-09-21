/**
 * Commission clawback exposure helper.
 *
 * Standard YBR / Mankin Finance clawback rules (most lenders):
 *   - 100% clawback within the first 12 months of settlement
 *   - 50% clawback between 12 and 18 months
 *   - 0% clawback after 18 months
 *
 * Two known exceptions:
 *   - Resimac: 0% clawback after 6 months
 *   - Bluestone: 0% clawback after 6 months
 *
 * The helper returns the current exposure so the anniversary copy and
 * the refinance opportunities console can shape their messaging:
 *   - "high" → never push refinance; lead with re-pricing and structure
 *   - "medium" → only mention refinance if the spread is huge; otherwise
 *     re-price + structure + flag a full review post-clawback
 *   - "clear" → actively push refinance positioning if the market is
 *     ahead of the customer's lender
 *
 * Pure function, no server-only imports, safe in client components.
 */

const DEFAULT_RULES = {
  fullClawbackMonths: 12,
  partialClawbackMonths: 18,
} as const;

/**
 * Lender-specific clawback overrides. Keys are matched against the
 * normalised lender string (lowercased, no parenthesised suffix).
 * Add new entries as YBR / the lender confirm shorter windows.
 */
const CLAWBACK_OVERRIDES: Record<
  string,
  { fullClawbackMonths: number; partialClawbackMonths: number }
> = {
  resimac: { fullClawbackMonths: 6, partialClawbackMonths: 6 },
  bluestone: { fullClawbackMonths: 6, partialClawbackMonths: 6 },
};

export type ClawbackTier = "high" | "medium" | "clear";

export interface ClawbackStatus {
  /** Months since settlement (whole months, floored). */
  monthsSinceSettlement: number;
  /** Percentage of upfront commission we'd lose if the customer
   *  refinances today. 100 / 50 / 0. */
  clawbackPct: 100 | 50 | 0;
  /** Risk tier driving how aggressive the messaging can be. */
  tier: ClawbackTier;
  /** Plain-English status line for the broker UI. */
  description: string;
  /** Months remaining before clawback clears to 0%. Negative when
   *  already clear; UI should display 0 in that case. */
  monthsUntilClear: number;
  /** Convenience flag for templates: true when refinance can be
   *  actively pursued without commission risk. */
  safeToRefinance: boolean;
  /** The lender we matched (normalised) so callers can show "Resimac
   *  rules apply" instead of "default rules". null when default. */
  matchedOverride: string | null;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Months between two dates, floored. Settlement to today. */
export function monthsBetween(settlementIso: string, asOf: Date = new Date()): number {
  const settled = new Date(settlementIso);
  if (Number.isNaN(settled.getTime())) return 0;
  let months =
    (asOf.getFullYear() - settled.getFullYear()) * 12 +
    (asOf.getMonth() - settled.getMonth());
  if (asOf.getDate() < settled.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Compute the current clawback status for a settlement.
 *
 * @param lender - the lender on the settlement (free-form, normalised
 *                 against CLAWBACK_OVERRIDES)
 * @param settlementIso - ISO yyyy-mm-dd of settlement
 * @param asOf - optional date override for testing; defaults to now
 */
export function clawbackStatus(
  lender: string,
  settlementIso: string,
  asOf: Date = new Date(),
): ClawbackStatus {
  const months = monthsBetween(settlementIso, asOf);
  const { rule, matched } = ruleFor(lender);

  let pct: 100 | 50 | 0;
  let tier: ClawbackTier;
  if (months < rule.fullClawbackMonths) {
    pct = 100;
    tier = "high";
  } else if (months < rule.partialClawbackMonths) {
    pct = 50;
    tier = "medium";
  } else {
    pct = 0;
    tier = "clear";
  }

  const monthsUntilClear = Math.max(0, rule.partialClawbackMonths - months);
  const safeToRefinance = pct === 0;

  const description = describe({
    pct,
    months,
    rule,
    matched,
    monthsUntilClear,
  });

  return {
    monthsSinceSettlement: months,
    clawbackPct: pct,
    tier,
    description,
    monthsUntilClear,
    safeToRefinance,
    matchedOverride: matched,
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

function normaliseLender(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // strip "(chosen)" / "(proposed)"
    .trim();
}

function ruleFor(lender: string): {
  rule: { fullClawbackMonths: number; partialClawbackMonths: number };
  matched: string | null;
} {
  const norm = normaliseLender(lender);
  for (const key of Object.keys(CLAWBACK_OVERRIDES)) {
    if (norm.includes(key)) {
      return { rule: CLAWBACK_OVERRIDES[key], matched: key };
    }
  }
  return { rule: DEFAULT_RULES, matched: null };
}

function describe(args: {
  pct: 100 | 50 | 0;
  months: number;
  rule: { fullClawbackMonths: number; partialClawbackMonths: number };
  matched: string | null;
  monthsUntilClear: number;
}): string {
  const { pct, months, rule, matched, monthsUntilClear } = args;
  const lenderTag = matched
    ? ` (${matched.charAt(0).toUpperCase() + matched.slice(1)} rules: ${rule.partialClawbackMonths}mo)`
    : "";

  if (pct === 100) {
    return `100% clawback risk${lenderTag}. ${monthsUntilClear} months until clear. Lead with re-pricing + structure, never push refinance.`;
  }
  if (pct === 50) {
    return `50% clawback risk${lenderTag}. ${monthsUntilClear} months until clear. Re-pricing first; refinance only if the spread is large enough to offset the 50% loss.`;
  }
  return `Clawback clear${lenderTag}. ${months} months since settlement. Active refinance positioning is on the table.`;
}

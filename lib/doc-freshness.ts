import "server-only";
import { cache } from "react";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "./db/client";
import { auditLog as auditLogTable } from "./db/schema";

/**
 * Document freshness / expiry — lender-relevant aging on every received
 * doc on a deal.
 *
 * v1 approach (this file):
 *  - Read each doc's upload timestamp from the audit_log table where
 *    portal.upload events live (with meta.docId).
 *  - Compare against a per-doc-type expiry rule (6wk for payslips,
 *    12mo for super/tax, none for one-off forms).
 *  - Return a freshness status (fresh / aging / stale / unknown).
 *
 * What this does NOT do (yet):
 *  - Read the actual date OFF the document image. A customer who uploads
 *    an old payslip today gets a "fresh" status here; only OCR would
 *    catch that the underlying doc is dated 3 months ago.
 *  - v2 will pipe each PDF/image through Claude Vision (Anthropic SDK
 *    already wired) to extract the document date and compare against
 *    that — a much more accurate signal.
 *
 * For now, upload date is the right proxy because brokers catch
 * obvious stale-doc cases at first review anyway.
 */

export type FreshnessStatus = "fresh" | "aging" | "stale" | "no-rule" | "unknown";

export interface DocFreshness {
  status: FreshnessStatus;
  /** ISO upload date (when the customer dropped it in the portal). */
  uploadedAt: string | null;
  /** Days since the upload. null when uploadedAt is null. */
  daysOld: number | null;
  /** How many days before this doc is considered stale by the rule. */
  daysUntilStale: number | null;
  /** Customer-readable rule description, e.g. "within 6 weeks". */
  ruleDescription: string;
}

interface ExpiryRule {
  /** Lender-side cutoff in days. Doc is stale once daysOld > windowDays. */
  windowDays: number | null;
  /** Lower bound (in days) for the "aging — refresh soon" warning. */
  warnDays: number;
  description: string;
}

/**
 * Per-doc-id expiry rule. Calibrated to standard lender requirements for
 * residential lending in AU. When in doubt, default rule (6 weeks) wins.
 *
 * Keep this map flat + grep-friendly — the catalog evolves and brokers
 * will request tweaks ("CBA wants payslips within 4 weeks not 6") —
 * which they can self-service by editing one line each.
 */
const EXPIRY_RULES: Record<string, ExpiryRule> = {
  /* Time-sensitive — typical 6-week window */
  payslips: { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "payslips-a2": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  savings: { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  deposit: { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "savings-a2": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  loans: { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "other-loan": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "other-loans": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "credit-cards": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "existing-loan": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  "inv-loan": { windowDays: 42, warnDays: 21, description: "within 6 weeks of lodgement" },
  rentals: { windowDays: 60, warnDays: 30, description: "within 2 months — rental statements" },
  "tax-summary": { windowDays: 365, warnDays: 90, description: "most recent tax year" },
  "pays-yr": { windowDays: 365, warnDays: 90, description: "most recent tax year" },

  /* Annual — 12-month window */
  super: { windowDays: 365, warnDays: 90, description: "within the last 12 months" },
  "super-a2": { windowDays: 365, warnDays: 90, description: "within the last 12 months" },
  "tax-individual": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "noa-individual": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "tax-company": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "fin-company": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "tax-trust": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "tax-self": { windowDays: 365, warnDays: 90, description: "most recent financial year" },
  "fhg-eligibility": { windowDays: 365, warnDays: 90, description: "within the last 12 months" },
  "notice-ato": { windowDays: 365, warnDays: 90, description: "most recent NOA" },
  "rates-notice": { windowDays: 365, warnDays: 90, description: "most recent annual rates notice" },
  "cert-currency": { windowDays: 365, warnDays: 60, description: "current policy period" },

  /* One-off — no expiry, signed once / valid permanently */
  privacy: { windowDays: null, warnDays: 0, description: "signed once" },
  id: { windowDays: null, warnDays: 0, description: "valid ID, no expiry tracking" },
  "id-a1": { windowDays: null, warnDays: 0, description: "valid ID, no expiry tracking" },
  "id-a2": { windowDays: null, warnDays: 0, description: "valid ID, no expiry tracking" },
  "fhb-declaration": { windowDays: null, warnDays: 0, description: "one-off declaration" },
  "genuine-savings": { windowDays: null, warnDays: 0, description: "point-in-time evidence" },
  contract: { windowDays: null, warnDays: 0, description: "signed contract — no aging" },
  "fhbg-app": { windowDays: null, warnDays: 0, description: "one-off application" },
  "fhog-nsw": { windowDays: null, warnDays: 0, description: "one-off application" },
  discharge: { windowDays: null, warnDays: 0, description: "one-off authority" },
  "trust-deed": { windowDays: null, warnDays: 0, description: "one-off — keep on file" },
  "loan-app-pack": { windowDays: null, warnDays: 0, description: "deal-specific submission" },
  "signed-acceptance": { windowDays: null, warnDays: 0, description: "deal-specific submission" },
  dependents: { windowDays: null, warnDays: 0, description: "one-off declaration" },

  /* Construction docs — most are one-off */
  "builders-quote": { windowDays: null, warnDays: 0, description: "one-off — keep on file" },
  "building-plans": { windowDays: null, warnDays: 0, description: "one-off — keep on file" },
  "land-contract": { windowDays: null, warnDays: 0, description: "one-off — keep on file" },
  "builder-licence": { windowDays: 365, warnDays: 60, description: "current licence + insurance" },
  "progress-draws": { windowDays: null, warnDays: 0, description: "one-off schedule" },
  "sale-contract": { windowDays: null, warnDays: 0, description: "one-off contract" },
  "valuation-existing": { windowDays: 90, warnDays: 30, description: "within the last 3 months" },
};

/** Default for any doc id not in the rules table — assume 6-week window
 *  since that's the most common lender requirement. Broker can override
 *  by adding a rule when it matters. */
const DEFAULT_RULE: ExpiryRule = {
  windowDays: 42,
  warnDays: 21,
  description: "within 6 weeks of lodgement (default)",
};

/** Look up the rule for a given doc id. Custom docs (prefixed
 *  "custom-") get the default rule unless someone overrides. */
export function expiryRuleFor(docId: string): ExpiryRule {
  return EXPIRY_RULES[docId] ?? DEFAULT_RULE;
}

/* -------------------------------------------------------------------------- */
/* Upload-date lookup                                                         */
/* -------------------------------------------------------------------------- */

/** Read the audit log for portal.upload events on this deal and build
 *  a Map of docId → most-recent upload ISO.
 *
 *  Perf: wrapped in React's cache() so the drawer rendering N badges
 *  + the summary banner share one fetch per request. Only selects the
 *  two columns we need (createdAt + meta) instead of SELECT * - the
 *  audit_log row is wide and includes the full JSON meta blob, so
 *  dropping unused columns trims serialization cost. Caps at 500 rows
 *  - well past what any single deal accumulates and avoids a runaway
 *  scan if the audit log grows to millions. */
export const getDocUploadDates = cache(async (dealId: string): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  if (!process.env.DATABASE_URL) return map;
  try {
    const db = getDb();
    const rows = await db
      .select({
        createdAt: auditLogTable.createdAt,
        meta: auditLogTable.meta,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.dealId, dealId),
          eq(auditLogTable.action, "portal.upload"),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(500);
    for (const r of rows) {
      const meta = (r.meta as { docId?: string } | null) ?? null;
      const docId = meta?.docId;
      if (!docId) continue;
      // First write wins because we ordered by createdAt desc — newest
      // upload of a re-submitted doc is what counts.
      if (!map.has(docId)) {
        map.set(docId, r.createdAt.toISOString());
      }
    }
  } catch (err) {
    // Missing audit_log table or DB failure → return empty map. The UI
    // shows "no upload date on file" badges rather than crashing.
    if ((err as { code?: string })?.code === "42P01") {
      return map;
    }
    console.error("[doc-freshness] audit log query failed", err instanceof Error ? err.message : String(err));
  }
  return map;
});

/* -------------------------------------------------------------------------- */
/* Freshness classifier                                                       */
/* -------------------------------------------------------------------------- */

export function freshnessFor(
  docId: string,
  uploadedAtIso: string | null,
  today: Date = new Date(),
): DocFreshness {
  const rule = expiryRuleFor(docId);

  // No expiry rule → "no-rule" status, never warns the broker.
  if (rule.windowDays === null) {
    return {
      status: "no-rule",
      uploadedAt: uploadedAtIso,
      daysOld: uploadedAtIso ? daysBetween(today, new Date(uploadedAtIso)) : null,
      daysUntilStale: null,
      ruleDescription: rule.description,
    };
  }

  if (!uploadedAtIso) {
    return {
      status: "unknown",
      uploadedAt: null,
      daysOld: null,
      daysUntilStale: rule.windowDays,
      ruleDescription: rule.description,
    };
  }

  const daysOld = daysBetween(today, new Date(uploadedAtIso));
  const daysUntilStale = rule.windowDays - daysOld;

  let status: FreshnessStatus;
  if (daysOld <= rule.windowDays - rule.warnDays) {
    status = "fresh";
  } else if (daysOld <= rule.windowDays) {
    status = "aging";
  } else {
    status = "stale";
  }

  return {
    status,
    uploadedAt: uploadedAtIso,
    daysOld,
    daysUntilStale,
    ruleDescription: rule.description,
  };
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86400000));
}

/** Convenience: classify every received doc on a deal in one pass.
 *  Used by the deal drawer banner + per-row badges.
 *
 *  Short-circuits when there are no received docs - which is true for
 *  every back-book CSV import the broker does. Without this, opening
 *  a freshly-imported deal fired a SELECT * FROM audit_log query just
 *  to confirm "yes, still zero received docs" - and that scan dominated
 *  the drawer-open time (5+ seconds when the audit log grew large). */
export async function freshnessForDeal(args: {
  dealId: string;
  receivedDocIds: string[];
  today?: Date;
}): Promise<Map<string, DocFreshness>> {
  const out = new Map<string, DocFreshness>();
  if (args.receivedDocIds.length === 0) return out;
  const dates = await getDocUploadDates(args.dealId);
  for (const id of args.receivedDocIds) {
    out.set(id, freshnessFor(id, dates.get(id) ?? null, args.today));
  }
  return out;
}

/** Summary across a deal — counts per status. Drives the drawer banner. */
export function freshnessSummary(map: Map<string, DocFreshness>): {
  stale: number;
  aging: number;
  fresh: number;
  unknown: number;
} {
  const out = { stale: 0, aging: 0, fresh: 0, unknown: 0 };
  for (const f of map.values()) {
    if (f.status === "stale") out.stale++;
    else if (f.status === "aging") out.aging++;
    else if (f.status === "fresh") out.fresh++;
    else if (f.status === "unknown") out.unknown++;
    // "no-rule" intentionally not counted — privacy form etc. don't
    // need to ping the broker.
  }
  return out;
}

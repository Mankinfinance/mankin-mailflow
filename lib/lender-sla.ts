import "server-only";
import { cache } from "react";
import type { Deal } from "./clients/salestrekker/types";
import { repos } from "./db/repos";
import {
  EMPTY_SLA,
  LENDER_SLA_SEED,
  lenderIdByName,
  parseLenderField,
  type LenderSlaValues,
} from "./lenders";

/**
 * Resolves a deal's lender SLAs and turns them into "where should this be
 * by now" status the comms + priority reports lean on.
 *
 * The SLA is connected to the deal through its selected lender: we parse
 * the lender name off deal.lender, map it to a lender id, and look up the
 * turnaround days. Effective values are the code seed (LENDER_SLA_SEED)
 * overridden by anything saved in the SLA editor, so changing a lender's
 * SLA immediately reflows every deal on that lender. Which segment applies
 * depends on the deal's stage and (at lodgement) whether it's a refinance.
 */

/** Effective SLAs as a { lenderId -> values } map: seed defaults with any
 *  DB overrides layered on top. Cached per request. */
export const getLenderSlaMap = cache(
  async (): Promise<Map<string, LenderSlaValues>> => {
    const map = new Map<string, LenderSlaValues>();
    // Start from the seeded defaults.
    for (const [id, v] of Object.entries(LENDER_SLA_SEED)) {
      map.set(id, { ...v });
    }
    // Overlay saved edits (a stored row wins outright for that lender).
    for (const r of await repos().lenderSla.all()) {
      map.set(r.lenderId, {
        purchaseAssessDays: r.purchaseAssessDays,
        refinanceAssessDays: r.refinanceAssessDays,
        preApprovalDays: r.preApprovalDays,
        formalDays: r.formalDays,
      });
    }
    return map;
  },
);

/** Most recent time any lender SLA was edited, or null when none have been
 *  (the table is still on seeded defaults). Powers the "last updated" line. */
export const getLenderSlaLastUpdated = cache(
  async (): Promise<Date | null> => {
    let latest: Date | null = null;
    for (const r of await repos().lenderSla.all()) {
      if (!latest || r.updatedAt > latest) latest = r.updatedAt;
    }
    return latest;
  },
);

/** The SLA values for a deal's selected lender, or EMPTY_SLA when unset. */
export function slaForDeal(
  deal: Deal,
  slaMap: Map<string, LenderSlaValues>,
): LenderSlaValues {
  const { lenderName } = parseLenderField(deal.lender);
  const id = lenderIdByName(lenderName);
  if (!id) return EMPTY_SLA;
  return slaMap.get(id) ?? EMPTY_SLA;
}

/** Whole business days between two dates (Mon-Fri, ignores public
 *  holidays). Same calendar day => 0. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/** Add N business days (Mon-Fri) to a date — used to project an SLA
 *  deadline from when a deal entered its current stage. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

export interface DealSlaStatus {
  /** SLA field governing the current stage's wait, or null. */
  key: keyof LenderSlaValues | null;
  /** Human label for the wait ("Assessment", "Formal approval", ...). */
  label: string | null;
  /** Customer-facing task phrase ("assessment", "formal approval", ...). */
  customerTask: string | null;
  /** Expected turnaround (business days) for that segment, or null. */
  expectedDays: number | null;
  /** Business days the deal has sat in its current stage, or null. */
  daysInStage: number | null;
  /** True when both figures are known and the wait has exceeded the SLA. */
  overdue: boolean;
  /** How far past SLA, in business days (0 when not overdue/unknown). */
  overdueBy: number;
}

const NO_STATUS: DealSlaStatus = {
  key: null,
  label: null,
  customerTask: null,
  expectedDays: null,
  daysInStage: null,
  overdue: false,
  overdueBy: 0,
};

/** Which SLA segment governs the current stage, and how to name it. */
function segmentForStage(
  deal: Deal,
): { key: keyof LenderSlaValues; label: string; customerTask: string } | null {
  switch (deal.stageId) {
    case "pre-approval":
      return { key: "preApprovalDays", label: "Pre-approval", customerTask: "pre-approval" };
    case "lodged":
      return deal.leadCategory === "refinance"
        ? { key: "refinanceAssessDays", label: "Refinance assessment", customerTask: "assessment" }
        : { key: "purchaseAssessDays", label: "Assessment", customerTask: "assessment" };
    case "cond-approved":
      return { key: "formalDays", label: "Formal approval", customerTask: "formal approval" };
    default:
      return null;
  }
}

/** Compute the SLA status for a deal's CURRENT stage. */
export function slaStatusForDeal(
  deal: Deal,
  slaMap: Map<string, LenderSlaValues>,
  now: Date = new Date(),
): DealSlaStatus {
  const seg = segmentForStage(deal);
  if (!seg) return NO_STATUS;

  const sla = slaForDeal(deal, slaMap);
  const expectedDays = sla[seg.key];
  const daysInStage = deal.stageEnteredAt
    ? businessDaysBetween(deal.stageEnteredAt, now)
    : null;
  const overdue =
    expectedDays !== null && daysInStage !== null && daysInStage > expectedDays;

  return {
    key: seg.key,
    label: seg.label,
    customerTask: seg.customerTask,
    expectedDays,
    daysInStage,
    overdue,
    overdueBy: overdue ? daysInStage! - expectedDays! : 0,
  };
}

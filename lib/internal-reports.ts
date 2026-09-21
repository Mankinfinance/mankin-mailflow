import type { Deal } from "./clients/salestrekker/types";
import { stageMeta } from "./clients/salestrekker/types";
import { teamMember, type TeamMemberId } from "./team";
import { slaStatusForDeal } from "./lender-sla";
import { slaInternalNote } from "./sla-comms";
import type { LenderSlaValues } from "./lenders";
import { formatTimestampAU } from "@/lib/format-date";

/**
 * Internal daily reports emailed to the Mankin ops inbox. Plain text so
 * they're robust in any mail client and easy to skim on a phone.
 *
 *  - Stale-deals (EOD): every active deal not touched in N days, so
 *    nothing goes quiet.
 *  - Priority: every active deal matching a risk trigger (SLA overdue,
 *    settlement booked with items outstanding, a broker flag, or gone
 *    cold), ranked so the team knows what to move first.
 */

const STALE_DAYS = 2;
const COLD_DAYS = 3;

function isActive(d: Deal): boolean {
  return d.stageId !== "settled" && d.nurturedAt === null;
}

function brokerShort(id: string): string {
  try {
    return teamMember(id as TeamMemberId).short;
  } catch {
    return id;
  }
}

function outstandingCount(d: Deal): number {
  return d.pending.length + d.overdue.length;
}

function fmtDate(now: Date): string {
  return formatTimestampAU(now);
}

export interface InternalReport {
  subject: string;
  body: string;
  /** How many deals the report flagged (0 => "all clear"). */
  count: number;
}

/* -------------------------------------------------------------------------- */
/* Stale-deals report (EOD)                                                    */
/* -------------------------------------------------------------------------- */

export function buildStaleDealsReport(
  deals: Deal[],
  now: Date = new Date(),
): InternalReport {
  const stale = deals
    .filter((d) => isActive(d) && d.daysSinceContact >= STALE_DAYS)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);

  const subject = `EOD follow-up report - ${stale.length} deal${
    stale.length === 1 ? "" : "s"
  } not touched in ${STALE_DAYS}+ days`;

  if (stale.length === 0) {
    return {
      subject: `EOD follow-up report - all deals touched in the last ${STALE_DAYS} days`,
      body: `${fmtDate(now)}\n\nEvery active deal has been contacted within the last ${STALE_DAYS} days. Nothing has gone quiet.`,
      count: 0,
    };
  }

  // Group by owning broker.
  const byBroker = new Map<string, Deal[]>();
  for (const d of stale) {
    const list = byBroker.get(d.brokerId) ?? [];
    list.push(d);
    byBroker.set(d.brokerId, list);
  }

  const lines: string[] = [
    fmtDate(now),
    "",
    `${stale.length} active deal${stale.length === 1 ? "" : "s"} not contacted in ${STALE_DAYS}+ days. Please follow up.`,
    "",
  ];
  for (const [brokerId, list] of byBroker) {
    lines.push(`${brokerShort(brokerId)} (${list.length}):`);
    for (const d of list) {
      const ref = d.appRef ? ` [${d.appRef}]` : "";
      const out = outstandingCount(d);
      const outNote = out > 0 ? `, ${out} doc${out === 1 ? "" : "s"} outstanding` : "";
      lines.push(
        `  - ${d.name}${ref} - ${stageMeta(d.stageId).shortLabel}, ${d.daysSinceContact} days since contact${outNote}`,
      );
    }
    lines.push("");
  }

  return { subject, body: lines.join("\n").trimEnd(), count: stale.length };
}

/* -------------------------------------------------------------------------- */
/* Priority report                                                             */
/* -------------------------------------------------------------------------- */

interface PriorityHit {
  deal: Deal;
  reasons: string[];
  score: number;
}

export function buildPriorityReport(
  deals: Deal[],
  slaMap: Map<string, LenderSlaValues>,
  now: Date = new Date(),
): InternalReport {
  const hits: PriorityHit[] = [];

  for (const d of deals) {
    if (!isActive(d)) continue;
    const reasons: string[] = [];
    let score = 0;

    // 1. SLA overdue (past the lender's turnaround for this stage).
    const sla = slaStatusForDeal(d, slaMap, now);
    if (sla.overdue) {
      const note = slaInternalNote(sla);
      reasons.push(`SLA overdue${note ? ` - ${note}` : ""}`);
      score += 100 + sla.overdueBy;
    }

    // 2. Settlement booked with items still outstanding.
    const out = outstandingCount(d);
    if (d.stageId === "settle-booked" && out > 0) {
      reasons.push(`Settlement booked, ${out} item${out === 1 ? "" : "s"} outstanding`);
      score += 80;
    }

    // 3. Carrying a broker priority flag.
    if (d.priorityFlag === "outstanding-action") {
      reasons.push("Flagged: outstanding action");
      score += 60;
    } else if (d.priorityFlag === "follow-up") {
      reasons.push("Flagged: follow-up");
      score += 40;
    }

    // 4. Gone cold - no contact in COLD_DAYS+.
    if (d.daysSinceContact >= COLD_DAYS) {
      reasons.push(`No contact in ${d.daysSinceContact} days`);
      score += 20 + d.daysSinceContact;
    }

    if (reasons.length > 0) hits.push({ deal: d, reasons, score });
  }

  hits.sort((a, b) => b.score - a.score);

  const subject = `Priority report - ${hits.length} deal${
    hits.length === 1 ? "" : "s"
  } need attention`;

  if (hits.length === 0) {
    return {
      subject: "Priority report - nothing flagged, all on track",
      body: `${fmtDate(now)}\n\nNo active deals are SLA-overdue, settling with items outstanding, flagged, or gone cold. All on track.`,
      count: 0,
    };
  }

  const lines: string[] = [
    fmtDate(now),
    "",
    `${hits.length} deal${hits.length === 1 ? "" : "s"} need attention, most urgent first:`,
    "",
  ];
  for (const { deal: d, reasons } of hits) {
    const ref = d.appRef ? ` [${d.appRef}]` : "";
    lines.push(
      `${d.name}${ref} - ${brokerShort(d.brokerId)} - ${stageMeta(d.stageId).shortLabel}`,
    );
    for (const r of reasons) lines.push(`  - ${r}`);
    lines.push("");
  }

  return { subject, body: lines.join("\n").trimEnd(), count: hits.length };
}

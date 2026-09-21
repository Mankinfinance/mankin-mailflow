import type { Deal } from "./clients/salestrekker/types";

/**
 * Per-worker "Today" agenda — LoanFlow's answer to the Cashflow Legal
 * Today view. Each broker's day, as dated action items bucketed into
 * Overdue / Due today / This week, drawn from the signals the platform
 * already tracks: follow-up cadence, booked settlements, pre-approval
 * expiries and overdue documents.
 *
 * Pure over the deal list, so it's testable and identical on mock and
 * live data.
 */

/** How far ahead "this week" looks. */
const WEEK_DAYS = 7;

/**
 * How often a deal should be touched, by stage. New leads not yet lodged
 * need chasing fast; deals sitting with the lender can breathe a little
 * more; deals near settlement stay tight.
 */
export function cadenceForStage(stageId: Deal["stageId"]): number {
  switch (stageId) {
    case "pre-lodge":
      return 2; // new lead — move it
    case "loan-docs":
    case "settle-booked":
      return 3; // near settlement — stay close
    default:
      return 4; // with the lender
  }
}

export type AgendaKind = "Task" | "Date";
export type AgendaBucket = "overdue" | "today" | "week";

export interface AgendaItem {
  id: string;
  dealId: string;
  dealName: string;
  /** e.g. "Purchase · Westpac" — the matter line under the title. */
  context: string;
  title: string;
  kind: AgendaKind;
  /** ISO yyyy-mm-dd the item is due / dated. */
  date: string;
  bucket: AgendaBucket;
  /** "2 days ago" / "today" / "in 3 days". */
  relLabel: string;
}

export interface WorkerAgenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  week: AgendaItem[];
  counts: { overdue: number; today: number; week: number; total: number };
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole calendar days from `now` to `date` (negative = in the past). */
function dayDelta(date: Date, now: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function relLabel(delta: number): string {
  if (delta === 0) return "today";
  if (delta === -1) return "yesterday";
  if (delta === 1) return "tomorrow";
  return delta < 0 ? `${-delta} days ago` : `in ${delta} days`;
}

/** Parse LoanFlow's free-form settlement label ("14 Aug", "TBD"). */
function parseSettlement(label: string | null | undefined, now: Date): Date | null {
  if (!label) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(label.trim());
  if (!m) return null;
  const monthIdx = MONTH_INDEX[m[2].toLowerCase()];
  if (monthIdx === undefined) return null;
  let year = now.getFullYear();
  const candidate = new Date(year, monthIdx, parseInt(m[1], 10));
  if (candidate.getTime() < now.getTime() - 30 * 86_400_000) year += 1;
  return new Date(year, monthIdx, parseInt(m[1], 10));
}

function bucketFor(delta: number): AgendaBucket | null {
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta <= WEEK_DAYS) return "week";
  return null; // further out — off the agenda
}

function contextLine(deal: Deal): string {
  const cat = deal.leadCategory && deal.leadCategory !== "unknown"
    ? deal.leadCategory.charAt(0).toUpperCase() + deal.leadCategory.slice(1)
    : "Loan";
  const lender = (deal.lender || "")
    .replace(/\s*\((proposed|chosen)\)\s*/gi, "")
    .trim();
  return lender && !/^(tbc|tbd)$/i.test(lender) ? `${cat} · ${lender}` : cat;
}

/**
 * Build one worker's agenda. A deal is on the worker's agenda when they
 * own it (brokerId) or support it (associateId), so brokers and associates
 * both get a real day.
 */
export function buildWorkerAgenda(
  deals: Deal[],
  memberId: string,
  now: Date = new Date(),
  /** Precomputed lender-SLA deadlines per deal (the page supplies these,
   *  since the SLA data is server-side). Adds a dated SLA item each. */
  slaDueByDeal?: Map<string, { label: string; date: Date }>,
): WorkerAgenda {
  const owned = deals.filter(
    (d) =>
      (d.brokerId === memberId || d.associateId === memberId) &&
      d.stageId !== "settled" &&
      d.nurturedAt === null,
  );

  const items: AgendaItem[] = [];
  const push = (deal: Deal, partial: Omit<AgendaItem, "dealId" | "dealName" | "context" | "bucket" | "relLabel"> & { date: string }, when: Date) => {
    const delta = dayDelta(when, now);
    const bucket = bucketFor(delta);
    if (!bucket) return;
    items.push({
      ...partial,
      dealId: deal.id,
      dealName: deal.name,
      context: contextLine(deal),
      bucket,
      relLabel: relLabel(delta),
    });
  };

  for (const deal of owned) {
    // 1. Follow-up cadence (Task). Due = last contact + cadence.
    const lastContact = deal.lastContactAt instanceof Date
      ? startOfDay(deal.lastContactAt)
      : addDays(now, -deal.daysSinceContact);
    const followUpDue = addDays(lastContact, cadenceForStage(deal.stageId));
    push(
      deal,
      { id: `${deal.id}:followup`, title: "Follow up with client", kind: "Task", date: isoDate(followUpDue) },
      followUpDue,
    );

    // 2. Overdue documents (Task) — always overdue when present.
    if (deal.overdue.length > 0) {
      const when = addDays(now, -Math.max(1, deal.daysSinceContact));
      push(
        deal,
        {
          id: `${deal.id}:docs`,
          title: `Chase ${deal.overdue.length} outstanding document${deal.overdue.length === 1 ? "" : "s"}`,
          kind: "Task",
          date: isoDate(when),
        },
        when,
      );
    }

    // 3. Booked settlement (Date).
    const settleDate = parseSettlement(deal.settlement, now);
    if (settleDate) {
      push(
        deal,
        { id: `${deal.id}:settle`, title: "Settlement", kind: "Date", date: isoDate(settleDate) },
        settleDate,
      );
    }

    // 4. Lender SLA deadline (Date) — when the current stage should clear.
    const sla = slaDueByDeal?.get(deal.id);
    if (sla) {
      push(
        deal,
        { id: `${deal.id}:sla`, title: `Lender SLA — ${sla.label.toLowerCase()}`, kind: "Date", date: isoDate(sla.date) },
        sla.date,
      );
    }

    // 5. Pre-approval expiry (Date).
    if (deal.preApprovalExpiry) {
      const exp = new Date(deal.preApprovalExpiry);
      if (!Number.isNaN(exp.getTime())) {
        push(
          deal,
          { id: `${deal.id}:preapproval`, title: "Pre-approval expires", kind: "Date", date: isoDate(exp) },
          exp,
        );
      }
    }
  }

  // Sort within each bucket: overdue longest-first, upcoming soonest-first.
  const byDate = (dir: 1 | -1) => (a: AgendaItem, b: AgendaItem) =>
    dir * a.date.localeCompare(b.date) || a.dealName.localeCompare(b.dealName);

  const overdue = items.filter((i) => i.bucket === "overdue").sort(byDate(1)); // oldest date first
  const today = items.filter((i) => i.bucket === "today").sort(byDate(1));
  const week = items.filter((i) => i.bucket === "week").sort(byDate(1)); // soonest first

  return {
    overdue,
    today,
    week,
    counts: {
      overdue: overdue.length,
      today: today.length,
      week: week.length,
      total: overdue.length + today.length + week.length,
    },
  };
}

export interface TeamAgendaSummary {
  memberId: string;
  overdue: number;
  today: number;
  week: number;
  total: number;
  /** The worker's most pressing overdue item title, for a one-line preview. */
  topOverdue: string | null;
}

/**
 * Roll up every worker's agenda counts for the manager view — who's
 * buried and who has room. Sorted most-overdue first.
 */
export function summariseTeamAgendas(
  deals: Deal[],
  memberIds: string[],
  now: Date = new Date(),
  slaDueByDeal?: Map<string, { label: string; date: Date }>,
): TeamAgendaSummary[] {
  return memberIds
    .map((memberId) => {
      const a = buildWorkerAgenda(deals, memberId, now, slaDueByDeal);
      return {
        memberId,
        overdue: a.counts.overdue,
        today: a.counts.today,
        week: a.counts.week,
        total: a.counts.total,
        topOverdue: a.overdue[0]?.title ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.overdue - a.overdue || b.today - a.today || b.total - a.total,
    );
}

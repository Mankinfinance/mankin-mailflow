import "server-only";
import type { Deal, StageId } from "@/lib/clients/salestrekker/types";
import type { TeamMember } from "@/lib/team";
import {
  startOfThisWeek,
  summariseActivities,
  type ActivitySummary,
} from "./productivity";
import { activeLeaves, type ActiveLeave } from "./handover";

/**
 * Capacity tooling — answers "who can take on more work?".
 *
 * Inputs per person:
 *   - logged minutes this week (from the activity feed)
 *   - pending load = estimated minutes of work still owed this week
 *     based on the deals assigned to them and where each sits in the
 *     B.1-B.7 pipeline.
 *
 * Total load = logged + pending. Capacity left = target - total.
 * Status traffic-lights the percentage so the dashboard can render a
 * "Maddison underallocated" pill without each caller doing the maths.
 *
 * The numbers below are sensible defaults — broker preferences live
 * in TEAM_WEEKLY_TARGET so they're tunable per-person later (some
 * brokers work 4-day weeks, etc.).
 */

/** Standard AU full-time work week = 38 hours = 2280 minutes. */
export const WEEKLY_TARGET_MINUTES = 38 * 60;

/**
 * Estimated weekly broker/associate effort PER deal, by stage. These
 * are coarse — meant as a planning aid, not a billing system. Numbers
 * deliberately err on the low side so a half-full capacity bar still
 * looks comfortable.
 */
const STAGE_LOAD_MINS_PER_WEEK: Record<StageId, number> = {
  "pre-lodge":     20, // chasing docs + prep
  lodged:          10, // status checks while at lender
  "cond-approved": 15, // condition follow-up
  "pre-approval":   8, // periodic touch base while customer house-hunts
  unconditional:   10, // hand-off prep
  "loan-docs":     15, // doc-signing coordination
  "settle-booked": 20, // settlement coordination
  settled:          0, // post-settlement nurture is automated
};

/** Extra minutes per pending/overdue doc the customer still owes us. */
const PENDING_DOC_MINS = 5;
const OVERDUE_DOC_MINS = 10;
/** Extra minutes per outstanding advisory note. */
const ADVISORY_MINS = 5;

/** Estimate how much pending work a single deal is expected to consume
 *  this week. Returns 0 for settled deals. */
function estimatePendingForDeal(deal: Deal): number {
  const stageBase = STAGE_LOAD_MINS_PER_WEEK[deal.stageId] ?? 0;
  const docLoad =
    deal.pending.length * PENDING_DOC_MINS +
    deal.overdue.length * OVERDUE_DOC_MINS +
    deal.advisory.length * ADVISORY_MINS;
  return stageBase + docLoad;
}

export type CapacityStatus = "under" | "balanced" | "loaded" | "over";

export interface PersonCapacity {
  member: TeamMember;
  /** Minutes already logged this week. */
  loggedMinutes: number;
  /** Estimated minutes of pending work assigned this week (their own). */
  pendingMinutes: number;
  /**
   * Extra minutes of pending workload this person is covering for
   * someone on leave. Always 0 if they're not covering anyone.
   */
  coveredMinutes: number;
  /** logged + pending + covered */
  totalMinutes: number;
  /** % of WEEKLY_TARGET_MINUTES the totalMinutes represents. */
  percentLoaded: number;
  /** Minutes still available before hitting target (negative = over). */
  capacityLeftMinutes: number;
  /** Bucketised for traffic-light styling. */
  status: CapacityStatus;
  /** Count of open deals on which this person is assigned (broker or associate). */
  dealCount: number;
  /**
   * Active leave window for this person, if any. When set the row
   * should render greyed out + show "On leave · covered by X".
   */
  leave: ActiveLeave | null;
  /**
   * Team-member ids this person is currently covering for. Used by
   * the UI to render a "+ covering for Maddison" badge.
   */
  coveringFor: string[];
}

function statusFor(percent: number): CapacityStatus {
  if (percent < 50) return "under";
  if (percent < 80) return "balanced";
  if (percent <= 100) return "loaded";
  return "over";
}

/**
 * Race a promise against a timeout. Used to make DB-backed capacity
 * lookups resilient: if Supabase is slow / unreachable, the dashboard
 * still renders with empty productivity data instead of timing out
 * the whole Vercel function (which Chrome shows as "page couldn't load").
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[capacity] ${label} timed out after ${ms}ms - using fallback`);
      resolve(fallback);
    }, ms);
    promise
      .then((v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[capacity] ${label} failed - using fallback:`, err);
        resolve(fallback);
      });
  });
}

export async function calculateTeamCapacity(args: {
  team: readonly TeamMember[];
  deals: Deal[];
}): Promise<PersonCapacity[]> {
  const weekStart = startOfThisWeek();
  // Cap each DB call at 4s so the dashboard always renders within
  // Vercel's serverless function timeout, even if Supabase is unreachable.
  const [summary, leaves] = await Promise.all([
    withTimeout(
      summariseActivities(weekStart),
      4000,
      {
        totalMinutes: 0,
        byBroker: {},
        byTaskType: {} as ActivitySummary["byTaskType"],
        rows: [],
      } as ActivitySummary,
      "summariseActivities",
    ),
    withTimeout(activeLeaves(), 4000, [] as ActiveLeave[], "activeLeaves"),
  ]);

  // Index leaves two ways:
  //  • leaveByMember: "is X on leave right now?"
  //  • coveringByCoverer: "whose work is X currently covering?"
  const leaveByMember = new Map<string, ActiveLeave>();
  const coveringByCoverer = new Map<string, string[]>();
  for (const lv of leaves) {
    leaveByMember.set(lv.memberId, lv);
    const arr = coveringByCoverer.get(lv.coveringMemberId) ?? [];
    arr.push(lv.memberId);
    coveringByCoverer.set(lv.coveringMemberId, arr);
  }

  // Pre-compute "this person's own pending workload" once. Used both
  // for the person's row AND to add to whoever's covering them.
  const ownPendingByMember = new Map<string, number>();
  const ownDealsByMember = new Map<string, Deal[]>();
  for (const m of args.team) {
    const owned = args.deals.filter(
      (d) =>
        d.stageId !== "settled" &&
        d.nurturedAt === null &&
        (d.brokerId === m.id || d.associateId === m.id),
    );
    ownDealsByMember.set(m.id, owned);
    ownPendingByMember.set(
      m.id,
      owned.reduce((sum, d) => sum + estimatePendingForDeal(d), 0),
    );
  }

  return args.team.map((m) => {
    const loggedMinutes = summary.byBroker[m.id] ?? 0;
    const onLeave = leaveByMember.get(m.id) ?? null;

    // Person's own pending workload. While on leave they're not
    // expected to do anything — pending counts as 0 against them; it
    // flows entirely to the covering member.
    const ownPending = onLeave ? 0 : (ownPendingByMember.get(m.id) ?? 0);

    // Workload they're covering for others on leave.
    const coveringIds = coveringByCoverer.get(m.id) ?? [];
    const coveredMinutes = coveringIds.reduce(
      (sum, id) => sum + (ownPendingByMember.get(id) ?? 0),
      0,
    );

    const totalMinutes = loggedMinutes + ownPending + coveredMinutes;
    const percentLoaded = Math.round(
      (totalMinutes / WEEKLY_TARGET_MINUTES) * 100,
    );
    const capacityLeftMinutes = WEEKLY_TARGET_MINUTES - totalMinutes;
    const ownDealCount = ownDealsByMember.get(m.id)?.length ?? 0;
    const coveredDealCount = coveringIds.reduce(
      (sum, id) => sum + (ownDealsByMember.get(id)?.length ?? 0),
      0,
    );

    return {
      member: m,
      loggedMinutes,
      pendingMinutes: ownPending,
      coveredMinutes,
      totalMinutes,
      percentLoaded,
      capacityLeftMinutes,
      status: onLeave ? "under" : statusFor(percentLoaded),
      dealCount: ownDealCount + coveredDealCount,
      leave: onLeave,
      coveringFor: coveringIds,
    };
  });
}

/** Sort capacities so the person with the most free time appears
 *  first — useful for picking who to hand a new deal to. */
export function sortByCapacityLeft(rows: PersonCapacity[]): PersonCapacity[] {
  return [...rows].sort(
    (a, b) => b.capacityLeftMinutes - a.capacityLeftMinutes,
  );
}

/* -------------------------------------------------------------------------- */
/* Smart assignment                                                            */
/* -------------------------------------------------------------------------- */

export interface AssigneeSuggestion {
  memberId: string;
  shortName: string;
  capacityLeftMinutes: number;
  percentLoaded: number;
  reason: string;
}

/**
 * Suggest the right person to take on new work given current load + role.
 * Excludes anyone on leave, prefers under-loaded > balanced. Returns null
 * if no team member of that role is available.
 */
export async function suggestAssignee(args: {
  team: readonly TeamMember[];
  deals: Deal[];
  role: "Finance Broker" | "Loan Associate" | "Client Experience Officer";
}): Promise<AssigneeSuggestion | null> {
  const capacities = await calculateTeamCapacity({
    team: args.team,
    deals: args.deals,
  });

  // Filter to the requested role, drop anyone currently on leave.
  const candidates = capacities.filter(
    (c) => c.member.role === args.role && !c.leave,
  );
  if (candidates.length === 0) return null;

  // Pick the one with the most free time — ties broken by fewest
  // assigned deals so the chart doesn't keep stacking on one person.
  candidates.sort((a, b) => {
    if (b.capacityLeftMinutes !== a.capacityLeftMinutes) {
      return b.capacityLeftMinutes - a.capacityLeftMinutes;
    }
    return a.dealCount - b.dealCount;
  });

  const winner = candidates[0];
  const reason =
    winner.status === "under"
      ? `${formatMinutesShort(winner.capacityLeftMinutes)} free · lowest load`
      : `${formatMinutesShort(winner.capacityLeftMinutes)} free · best of available`;

  return {
    memberId: winner.member.id,
    shortName: winner.member.short,
    capacityLeftMinutes: winner.capacityLeftMinutes,
    percentLoaded: winner.percentLoaded,
    reason,
  };
}

function formatMinutesShort(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = Math.round(minutes / 60);
  return `${h}h`;
}

/* -------------------------------------------------------------------------- */
/* Historical trend                                                            */
/* -------------------------------------------------------------------------- */

export interface WeekBucket {
  /** Monday 00:00 in local time. */
  start: Date;
  /** Sunday 23:59:59.999 in local time. */
  end: Date;
  /** Compact label like "12 May" / "this wk" for chart axes. */
  label: string;
  /** Minutes logged in this bucket, keyed by team member id. */
  minutesByBroker: Record<string, number>;
  /**
   * Per-person breakdown by task type so the trend chart can render
   * stacked bars. brokerId → taskType → minutes.
   */
  byBrokerByTaskType: Record<string, Record<string, number>>;
}

/**
 * Build N weekly buckets ending with the current week and walking
 * backwards. Each bucket has the totals for every team member so the
 * Reports trend chart can render small-multiples per person.
 *
 * "Real measurement" — only counts time actually logged in the
 * activity feed. We can't reconstruct historical pending workloads
 * without storing deal snapshots, so the trend chart deliberately
 * omits pending and focuses on what was done.
 */
export async function weeklyLoggedHistory(args: {
  weeks: number;
  now?: Date;
}): Promise<WeekBucket[]> {
  const now = args.now ?? new Date();
  const thisWeekStart = startOfThisWeek(now);

  // Compute every week window up front, then fetch all summaries
  // concurrently. Previously this awaited one summariseActivities query
  // per week inside the loop — args.weeks (typically 8) serial
  // round-trips to Supabase Sydney; Promise.all collapses them to one
  // round-trip's worth of wall-clock.
  const windows = [];
  for (let i = args.weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(end.getMilliseconds() - 1);
    windows.push({ i, start, end });
  }

  const summaries = await Promise.all(
    windows.map((w) => summariseActivities(w.start, w.end)),
  );

  return windows.map(({ i, start, end }, idx) => {
    const summary = summaries[idx];

    // Build per-broker × per-task-type matrix from the raw rows so the
    // trend chart can render stacked bars.
    const byBrokerByTaskType: Record<string, Record<string, number>> = {};
    for (const r of summary.rows) {
      if (!byBrokerByTaskType[r.brokerId]) byBrokerByTaskType[r.brokerId] = {};
      const bucket = byBrokerByTaskType[r.brokerId];
      bucket[r.taskType] = (bucket[r.taskType] ?? 0) + r.minutes;
    }

    return {
      start,
      end,
      label:
        i === 0
          ? "this wk"
          : i === 1
            ? "last wk"
            : start.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
      minutesByBroker: summary.byBroker,
      byBrokerByTaskType,
    };
  });
}

/**
 * Daily variant of weeklyLoggedHistory — N day buckets ending today.
 * Uses the same WeekBucket interface so the trend chart renderer can
 * accept either view without branching.
 *
 * Bar normalisation is still against WEEKLY_TARGET_MINUTES so a daily
 * bar at 100% means "you logged 38h of work in a single day" — which
 * is intentionally rare and a flag worth seeing.
 */
export async function dailyLoggedHistory(args: {
  days: number;
  now?: Date;
}): Promise<WeekBucket[]> {
  const now = args.now ?? new Date();

  // Same optimisation as weeklyLoggedHistory: build the day windows,
  // then fetch all args.days (typically 14) summaries concurrently
  // instead of one serial query per day.
  const windows = [];
  for (let i = args.days - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    windows.push({ i, start, end });
  }

  const summaries = await Promise.all(
    windows.map((w) => summariseActivities(w.start, w.end)),
  );

  return windows.map(({ i, start, end }, idx) => {
    const summary = summaries[idx];
    const byBrokerByTaskType: Record<string, Record<string, number>> = {};
    for (const r of summary.rows) {
      if (!byBrokerByTaskType[r.brokerId]) byBrokerByTaskType[r.brokerId] = {};
      const bucket = byBrokerByTaskType[r.brokerId];
      bucket[r.taskType] = (bucket[r.taskType] ?? 0) + r.minutes;
    }

    return {
      start,
      end,
      label:
        i === 0
          ? "today"
          : i === 1
            ? "yest."
            : start.toLocaleDateString("en-AU", { weekday: "short" }),
      minutesByBroker: summary.byBroker,
      byBrokerByTaskType,
    };
  });
}

/** "Maddison can take on ~6h more this week" — single-line summary
 *  used by the sidebar "Who's free?" widget. */
export function summaryLine(row: PersonCapacity): string {
  if (row.status === "over") {
    const overBy = Math.abs(row.capacityLeftMinutes);
    return `${row.member.short} is over by ${formatShortDuration(overBy)} this week`;
  }
  return `${row.member.short} has ${formatShortDuration(row.capacityLeftMinutes)} free`;
}

function formatShortDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

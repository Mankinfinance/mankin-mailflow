import "server-only";
import { repos } from "@/lib/db/repos";
import type { ActivityRow } from "@/lib/db/schema";

/**
 * Productivity tracker — converts broker actions into time-budget rows
 * so the dashboard can render "hours logged today / this week / this
 * month" plus a per-task-type breakdown.
 *
 * The duration table here is the single source of truth. Don't read
 * individual numbers in components — call minutesFor(taskType) so the
 * mapping stays in one place. (We also denormalise the minutes onto
 * each row at insert-time so historic totals don't get retroactively
 * rewritten if you tune a number here later.)
 */

export type TaskType =
  | "follow-up"
  | "new-deal-refinance"
  | "new-deal-purchase"
  | "returned-app"
  | "repricing";

export interface TaskMeta {
  id: TaskType;
  label: string;
  minutes: number;
  /** Brief description shown in the picker dialog */
  description: string;
  /** Whether the broker can pick this from the manual logger. Some
   *  types (e.g. follow-up) are normally auto-logged so we still
   *  expose them — the broker can log a manual one if the auto path
   *  missed something. */
  manual: boolean;
}

export const TASK_TIMINGS: Record<TaskType, TaskMeta> = {
  "follow-up": {
    id: "follow-up",
    label: "Follow-up",
    minutes: 5,
    description: "Email or SMS chasing a doc or response.",
    manual: true,
  },
  "new-deal-refinance": {
    id: "new-deal-refinance",
    label: "New deal · refinance",
    minutes: 60,
    description: "Fresh refinance application — assessment + lender shortlist.",
    manual: true,
  },
  "new-deal-purchase": {
    id: "new-deal-purchase",
    label: "New deal · purchase",
    minutes: 65,
    description: "Fresh purchase application — assessment + lender shortlist.",
    manual: true,
  },
  "returned-app": {
    id: "returned-app",
    label: "Returned application",
    minutes: 30,
    description: "Previously-touched deal coming back (rework, reactivation).",
    manual: true,
  },
  repricing: {
    id: "repricing",
    label: "Repricing",
    minutes: 5,
    description: "Existing-client rate review or repricing request.",
    manual: true,
  },
};

export const TASK_TYPES: TaskType[] = Object.keys(TASK_TIMINGS) as TaskType[];

export function minutesFor(taskType: TaskType): number {
  return TASK_TIMINGS[taskType].minutes;
}

export function labelFor(taskType: TaskType): string {
  return TASK_TIMINGS[taskType].label;
}

export function isValidTaskType(value: string): value is TaskType {
  return value in TASK_TIMINGS;
}

/* -------------------------------------------------------------------------- */
/* Insert + query helpers                                                     */
/* -------------------------------------------------------------------------- */

export interface LogActivityInput {
  /** Team member who gets credit for the work — broker OR associate. */
  brokerId: string;
  taskType: TaskType;
  dealId?: string | null;
  note?: string | null;
  source?: "auto" | "manual";
}

/**
 * Returned application detection — fires when a deal that was waiting on
 * customer docs has now received one. We day-deduplicate per deal so a
 * batch upload counts as one ~30min processing event, not five.
 *
 * Credits the deal's associateId (the support staff who normally
 * process returned docs), with broker fallback if no associate.
 */
export async function logReturnedApplicationIfNeeded(args: {
  dealId: string;
  associateId: string | null;
  brokerId: string;
}): Promise<ActivityRow | null> {
  const target = args.associateId || args.brokerId;
  if (!target) return null;

  // Look for an existing returned-app entry for this deal logged today.
  // Same in-memory window for the mock; same SQL filter for real Postgres.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const recent = await repos().activity.listBetween(since, new Date());
  const alreadyLogged = recent.some(
    (r) => r.dealId === args.dealId && r.taskType === "returned-app",
  );
  if (alreadyLogged) return null;

  return logActivity({
    brokerId: target,
    taskType: "returned-app",
    dealId: args.dealId,
    note: "Customer returned requested docs",
    source: "auto",
  });
}

/**
 * Whether this deal has any prior outbound "follow-up" activity. Used
 * by the email subject builder to flip between "Deal Enquiry:" (first
 * contact) and "Deal Update:" (subsequent). Looks back 365 days.
 *
 * Returns true for brand-new deals with no logged follow-ups, false
 * for deals the broker has emailed before. Errors safely default to
 * false so we never accidentally treat a returning customer as new.
 */
export async function isFirstContactForDeal(dealId: string): Promise<boolean> {
  // Cap DB call at 3s so a sluggish or unreachable Supabase never makes
  // the dashboard page time out. Returning false (= "not first contact")
  // is the safer default - "Deal Update:" subject is right more often
  // than "Deal Enquiry:" in steady state.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[productivity] isFirstContactForDeal(${dealId}) timed out`);
      resolve(false);
    }, 3000);

    (async () => {
      try {
        const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        const rows = await repos().activity.listBetween(since, new Date());
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(
          !rows.some(
            (r) => r.dealId === dealId && r.taskType === "follow-up",
          ),
        );
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error("[productivity] isFirstContactForDeal failed", { dealId, err });
        resolve(false);
      }
    })();
  });
}

/**
 * Record one activity entry. Returns the inserted row so callers can
 * log the awarded minutes back to the user. Never throws — productivity
 * tracking is informational, not load-bearing for the underlying action.
 */
export async function logActivity(input: LogActivityInput): Promise<ActivityRow | null> {
  try {
    return await repos().activity.insert({
      brokerId: input.brokerId,
      dealId: input.dealId ?? null,
      taskType: input.taskType,
      minutes: minutesFor(input.taskType),
      note: input.note ?? null,
      source: input.source ?? "auto",
    });
  } catch (err) {
    console.error("[productivity] logActivity failed", { input, err });
    return null;
  }
}

export interface ActivitySummary {
  totalMinutes: number;
  byBroker: Record<string, number>;
  byTaskType: Record<TaskType, { count: number; minutes: number }>;
  rows: ActivityRow[];
}

/**
 * Aggregate the activities feed within a window. The Reports page
 * calls this three times per render (today, this week, this month)
 * and the result powers the productivity tiles + bar charts.
 */
export async function summariseActivities(
  since: Date,
  until: Date = new Date(),
): Promise<ActivitySummary> {
  const rows = await repos().activity.listBetween(since, until);

  const byBroker: Record<string, number> = {};
  const byTaskType: Record<TaskType, { count: number; minutes: number }> = {
    "follow-up": { count: 0, minutes: 0 },
    "new-deal-refinance": { count: 0, minutes: 0 },
    "new-deal-purchase": { count: 0, minutes: 0 },
    "returned-app": { count: 0, minutes: 0 },
    repricing: { count: 0, minutes: 0 },
  };
  let totalMinutes = 0;

  for (const r of rows) {
    totalMinutes += r.minutes;
    byBroker[r.brokerId] = (byBroker[r.brokerId] ?? 0) + r.minutes;
    if (isValidTaskType(r.taskType)) {
      byTaskType[r.taskType].count += 1;
      byTaskType[r.taskType].minutes += r.minutes;
    }
  }

  return { totalMinutes, byBroker, byTaskType, rows };
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                            */
/* -------------------------------------------------------------------------- */

/** "1h 35m" / "45m" / "0m" — kept generic so KPI tiles and rows agree. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* -------------------------------------------------------------------------- */
/* Time windows                                                               */
/* -------------------------------------------------------------------------- */

export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function startOfThisWeek(now: Date = new Date()): Date {
  // Treat Monday as the week start (matches typical AU broker reporting).
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

export function startOfThisMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

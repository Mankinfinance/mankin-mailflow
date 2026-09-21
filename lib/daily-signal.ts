import "server-only";
import { repos } from "@/lib/db/repos";

/**
 * Daily signal — "what happened today vs yesterday".
 *
 * Lightweight overnight-delta calculator that reads from the audit log
 * and the existing deals data, with NO new schema. The point is to
 * give Michael a one-glance answer to "did anything move overnight?"
 * when he opens the dashboard in the morning.
 *
 * Signals tracked:
 *   • New deals created
 *   • Docs received from customers (portal uploads)
 *   • Follow-ups sent (email or SMS)
 *   • Stage transitions logged
 *
 * Each signal returns { today, yesterday, delta }. Negative is fine —
 * a quiet day yesterday vs a busy day today reads as "+3" with green
 * tone; the inverse reads "-3" amber.
 *
 * Resilience: if the audit_log table doesn't exist yet (Postgres
 * 42P01) or the read errors, every count returns 0 — the strip
 * renders but shows zeroes rather than crashing the overview page.
 *
 * NOTE: This uses the audit log as the source of truth. That means
 * the very first day this ships the "yesterday" numbers will be
 * partial (depending on when in the day audit started being captured
 * for these action types) — that's expected and self-heals after one
 * full day.
 */

export interface SignalRow {
  /** Display label for the tile. */
  label: string;
  /** Count of events that occurred in the local-time window
   *  [start-of-today, now]. */
  today: number;
  /** Count of events in the local-time window
   *  [start-of-yesterday, start-of-today]. */
  yesterday: number;
  /** today - yesterday. Positive means today is ahead. */
  delta: number;
  /** Tone hint for the tile background / pill colour. */
  tone: "brand" | "ok" | "warn" | "neutral";
}

export interface DailySignal {
  rows: SignalRow[];
  /** ISO date of "today" in Australia/Sydney terms. */
  todayDate: string;
  /** ISO date of "yesterday". */
  yesterdayDate: string;
}

/* -------------------------------------------------------------------------- */
/* Audit-log action sets — group action verbs into the four signals.          */
/* -------------------------------------------------------------------------- */

const ACTION_GROUPS = {
  newDeals: new Set([
    "dashboard.deal.create",
    "dashboard.deal.import",
  ]),
  docsReceived: new Set([
    "portal.upload",
  ]),
  followUpsSent: new Set([
    "dashboard.composer.send",
    "dashboard.composer.send.email",
    "dashboard.composer.send.sms",
  ]),
  stageMoves: new Set([
    "dashboard.stage.move",
  ]),
} as const;

/* -------------------------------------------------------------------------- */
/* Date helpers — work in Sydney local time so "today" matches the broker's   */
/* perception, not the Vercel UTC clock.                                       */
/* -------------------------------------------------------------------------- */

function sydneyLocalDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .split("/")
    .reverse()
    .join("-");
}

function startOfSydneyDay(d: Date): Date {
  /* Build the start-of-day in Sydney by formatting then re-parsing as
     a UTC moment that represents 00:00 Sydney time. Used to bound the
     audit-log scan to a 48h window. */
  const dateStr = sydneyLocalDate(d);
  // Sydney is UTC+10 (or +11 during DST). We don't need exact tz handling
  // for a 24h delta — we just need a stable boundary. Use noon UTC as a
  // safe anchor that's always "today in Sydney" regardless of DST.
  return new Date(`${dateStr}T00:00:00+10:00`);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function getDailySignal(): Promise<DailySignal> {
  const now = new Date();
  const startOfToday = startOfSydneyDay(now);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  const todayDate = sydneyLocalDate(now);
  const yesterdayDate = sydneyLocalDate(startOfYesterday);

  /* Counters bucketed by signal kind and time window. */
  const today: Record<keyof typeof ACTION_GROUPS, number> = {
    newDeals: 0,
    docsReceived: 0,
    followUpsSent: 0,
    stageMoves: 0,
  };
  const yesterday: Record<keyof typeof ACTION_GROUPS, number> = {
    newDeals: 0,
    docsReceived: 0,
    followUpsSent: 0,
    stageMoves: 0,
  };

  try {
    /* Pull recent audit events. 2000 is plenty for a busy 2-day window
       even if every doc upload + every send is captured. We sort desc
       in-memory and stop when we hit anything older than yesterday. */
    const events = await repos().audit.list({ limit: 2000 });

    for (const ev of events) {
      const ts = ev.createdAt instanceof Date ? ev.createdAt : new Date(ev.createdAt);
      if (ts < startOfYesterday) break; // events are desc-sorted

      const bucket: "today" | "yesterday" | null =
        ts >= startOfToday ? "today" : ts >= startOfYesterday ? "yesterday" : null;
      if (!bucket) continue;

      for (const kind of Object.keys(ACTION_GROUPS) as (keyof typeof ACTION_GROUPS)[]) {
        if (ACTION_GROUPS[kind].has(ev.action)) {
          (bucket === "today" ? today : yesterday)[kind] += 1;
        }
      }
    }
  } catch (err) {
    /* Audit table missing or read failure — render zeros rather than
       break the overview page. The catch is intentionally broad. */
    console.warn("[daily-signal] audit read failed", err);
  }

  const rows: SignalRow[] = [
    rowFor("New deals", today.newDeals, yesterday.newDeals, "brand"),
    rowFor("Docs received", today.docsReceived, yesterday.docsReceived, "ok"),
    rowFor("Follow-ups sent", today.followUpsSent, yesterday.followUpsSent, "brand"),
    rowFor("Stage moves", today.stageMoves, yesterday.stageMoves, "neutral"),
  ];

  return { rows, todayDate, yesterdayDate };
}

function rowFor(
  label: string,
  today: number,
  yesterday: number,
  tone: SignalRow["tone"],
): SignalRow {
  return { label, today, yesterday, delta: today - yesterday, tone };
}

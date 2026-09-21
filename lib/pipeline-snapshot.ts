import "server-only";
import type { Deal } from "./clients/salestrekker/types";
import { stageCounts } from "./overview";
import { repos } from "./db/repos";

/**
 * Daily pipeline snapshots — the history behind the Pipeline overview's
 * "Previous Week" column and week-on-week change.
 *
 * A cron writes one row per day (per-stage + priority-flag counts); the
 * overview reads the snapshot from roughly a week ago and diffs against
 * today. Everything degrades gracefully: with no history yet, the
 * previous column simply renders "—".
 */

/** Local calendar day as YYYY-MM-DD — the snapshot's unique key. */
export function snapshotDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compute today's per-stage counts and persist them (idempotent per
 *  day). Called by the snapshot cron. Returns the counts written. */
export async function recordDailySnapshot(
  deals: Deal[],
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const counts = stageCounts(deals);
  await repos().pipelineSnapshot.record({
    snapshotDate: snapshotDateKey(now),
    counts,
  });
  return counts;
}

/**
 * The counts map from roughly a week ago, for the overview's week-on-week
 * column. Uses the most recent snapshot on or before (today - 7 days), so
 * a missed cron day still yields a sensible baseline. Returns null when
 * there's no snapshot history yet.
 */
export async function previousWeekCounts(
  now: Date = new Date(),
): Promise<Record<string, number> | null> {
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const row = await repos().pipelineSnapshot.onOrBefore(snapshotDateKey(weekAgo));
  return row?.counts ?? null;
}

import { describe, it, expect } from "vitest";
import { stageStatus, stageCounts } from "./overview";
import { recordDailySnapshot, previousWeekCounts } from "./pipeline-snapshot";
import { repos } from "./db/repos";
import type { Deal } from "./clients/salestrekker/types";

/**
 * Covers the daily-snapshot feature behind the overview's "Previous Week"
 * column: stageStatus computes deltas against a prior counts map, and the
 * snapshot round-trip (record -> previousWeekCounts) returns the ~7-day-ago
 * baseline. Runs against the in-memory mock repo.
 */

// Only stageId / priorityFlag / nurturedAt matter for the counts.
function deal(id: string, stageId: string): Deal {
  return { id, stageId, priorityFlag: null, nurturedAt: null } as unknown as Deal;
}

describe("stageStatus deltas", () => {
  it("renders '—' (null) for previous and change when no history", () => {
    const rows = stageStatus([deal("a", "lodged")], null);
    for (const r of rows) {
      expect(r.previous).toBeNull();
      expect(r.change).toBeNull();
    }
  });

  it("computes previous + change from a prior counts map", () => {
    const deals = [deal("a", "lodged"), deal("b", "lodged"), deal("c", "settled")];
    const current = stageCounts(deals); // Lodged: 2, Settled: 1
    const previous = { ...current, Lodged: 1 }; // a week ago there was 1 lodged
    const rows = stageStatus(deals, previous);
    const lodged = rows.find((r) => r.label === "Lodged")!;
    expect(lodged.current).toBe(2);
    expect(lodged.previous).toBe(1);
    expect(lodged.change).toBe(1); // +1 week-on-week
  });
});

describe("snapshot round-trip", () => {
  it("record then previousWeekCounts returns the ~7-day-ago baseline", async () => {
    const now = new Date("2026-06-15T09:00:00");
    const weekAgo = new Date("2026-06-08T09:00:00");

    // Snapshot from a week ago with a known count, plus a fresher one that
    // must NOT be picked as the "previous week" baseline.
    await repos().pipelineSnapshot.record({
      snapshotDate: "2026-06-08",
      counts: { Lodged: 4 },
    });
    await repos().pipelineSnapshot.record({
      snapshotDate: "2026-06-14",
      counts: { Lodged: 9 },
    });
    void weekAgo;

    const prev = await previousWeekCounts(now);
    // onOrBefore(2026-06-08) => the 06-08 snapshot, not the 06-14 one.
    expect(prev).toEqual({ Lodged: 4 });
  });

  it("recordDailySnapshot writes today's counts idempotently", async () => {
    const now = new Date("2026-07-01T09:00:00");
    const deals = [deal("x", "lodged")];
    await recordDailySnapshot(deals, now);
    await recordDailySnapshot(deals, now); // re-run same day
    const row = await repos().pipelineSnapshot.onOrBefore("2026-07-01");
    expect(row?.snapshotDate).toBe("2026-07-01");
    expect(row?.counts["Lodged"]).toBe(1);
  });
});

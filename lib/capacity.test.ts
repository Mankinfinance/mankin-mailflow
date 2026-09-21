import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

/**
 * Locks in weeklyLoggedHistory / dailyLoggedHistory after they moved
 * from a serial per-bucket query loop to a single Promise.all fan-out.
 * The risk in that change is index misalignment — a concurrent result
 * mapped onto the wrong window. The mock fingerprints each row with its
 * window's start day-of-month so every bucket can be checked against the
 * window it represents.
 */

// vi.hoisted keeps the mock fn defined before the hoisted vi.mock factory
// runs, avoiding the temporal-dead-zone ambiguity of referencing a plain
// const from inside a factory.
const { listBetween } = vi.hoisted(() => ({ listBetween: vi.fn() }));

vi.mock("@/lib/db/repos", () => ({
  repos: () => ({ activity: { listBetween } }),
}));

const { weeklyLoggedHistory, dailyLoggedHistory } = await import("./capacity");

beforeEach(() => {
  listBetween.mockReset();
  // One activity row per window, stamped so minutes === the window's
  // start day-of-month — a fingerprint the assertions map back.
  listBetween.mockImplementation(async (since: Date) => [
    {
      id: `row-${since.getTime()}`,
      createdAt: since,
      brokerId: "mm",
      dealId: null,
      taskType: "follow-up",
      minutes: since.getDate(),
      note: null,
      source: "auto",
    },
  ]);
});

const NOW = new Date("2026-03-18T10:00:00"); // a Wednesday

describe("weeklyLoggedHistory (parallel fetch)", () => {
  it("returns one chronological bucket per week, newest last", async () => {
    const buckets = await weeklyLoggedHistory({ weeks: 8, now: NOW });
    expect(buckets).toHaveLength(8);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].start.getTime()).toBeGreaterThan(
        buckets[i - 1].start.getTime(),
      );
    }
    expect(buckets[buckets.length - 1].label).toBe("this wk");
    expect(buckets[buckets.length - 2].label).toBe("last wk");
  });

  it("fires exactly one query per week (fan-out, not N+1 re-fetch)", async () => {
    await weeklyLoggedHistory({ weeks: 8, now: NOW });
    expect(listBetween).toHaveBeenCalledTimes(8);
  });

  it("maps each concurrent result onto its own window", async () => {
    const buckets = await weeklyLoggedHistory({ weeks: 8, now: NOW });
    for (const b of buckets) {
      expect(b.minutesByBroker["mm"]).toBe(b.start.getDate());
      expect(b.byBrokerByTaskType["mm"]["follow-up"]).toBe(b.start.getDate());
    }
  });
});

describe("dailyLoggedHistory (parallel fetch)", () => {
  it("returns one bucket per day, newest last, one query each", async () => {
    const buckets = await dailyLoggedHistory({ days: 14, now: NOW });
    expect(buckets).toHaveLength(14);
    expect(listBetween).toHaveBeenCalledTimes(14);
    expect(buckets[buckets.length - 1].label).toBe("today");
    expect(buckets[buckets.length - 2].label).toBe("yest.");
    for (const b of buckets) {
      expect(b.minutesByBroker["mm"]).toBe(b.start.getDate());
    }
  });
});

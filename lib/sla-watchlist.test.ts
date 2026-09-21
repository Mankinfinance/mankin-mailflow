import { describe, it, expect } from "vitest";
import { buildSlaWatchlist } from "./sla-watchlist";
import { lenderIdByName, type LenderSlaValues } from "./lenders";
import type { Deal } from "./clients/salestrekker/types";

/**
 * Anchored to a known week: 2026-07-13 is a Monday, so 13/14/15 Jul are
 * Mon/Tue/Wed and the business-day maths is deterministic.
 */
const NOW = new Date("2026-07-15T12:00:00");

function deal(p: {
  id: string;
  stageEnteredAt: string;
  stageId?: Deal["stageId"];
  leadCategory?: Deal["leadCategory"];
  nurturedAt?: string | null;
  lender?: string;
}): Deal {
  return {
    id: p.id,
    name: `Client ${p.id}`,
    brokerId: "mm",
    lender: p.lender ?? "Westpac",
    stageId: p.stageId ?? "lodged",
    leadCategory: p.leadCategory ?? "purchase",
    nurturedAt: p.nurturedAt ?? null,
    stageEnteredAt: new Date(p.stageEnteredAt),
  } as unknown as Deal;
}

// Westpac assessment SLA = 1 business day for this test.
const slaMap = new Map<string, LenderSlaValues>();
const westpacId = lenderIdByName("Westpac");
if (westpacId) {
  slaMap.set(westpacId, {
    purchaseAssessDays: 1,
    refinanceAssessDays: 1,
    preApprovalDays: 1,
    formalDays: 1,
  });
}

describe("buildSlaWatchlist", () => {
  it("buckets deals by overdue / due today / on track against the lender SLA", () => {
    const wl = buildSlaWatchlist(
      [
        deal({ id: "over", stageEnteredAt: "2026-07-13T09:00:00" }), // 2 biz days, SLA 1 → overdue by 1
        deal({ id: "due", stageEnteredAt: "2026-07-14T09:00:00" }), // 1 biz day == SLA → due today
        deal({ id: "ok", stageEnteredAt: "2026-07-15T09:00:00" }), // 0 biz days → on track
      ],
      slaMap,
      NOW,
    );
    expect(wl.counts.tracked).toBe(3);
    expect(wl.overdue.map((i) => i.dealId)).toEqual(["over"]);
    expect(wl.overdue[0].overdueBy).toBe(1);
    expect(wl.due.map((i) => i.dealId)).toEqual(["due"]);
    expect(wl.onTrack.map((i) => i.dealId)).toEqual(["ok"]);
  });

  it("excludes settled and nurtured deals, and stages with no SLA segment", () => {
    const wl = buildSlaWatchlist(
      [
        deal({ id: "settled", stageEnteredAt: "2026-07-13T09:00:00", stageId: "settled" }),
        deal({ id: "parked", stageEnteredAt: "2026-07-13T09:00:00", nurturedAt: "2026-01-01" }),
        deal({ id: "prelodge", stageEnteredAt: "2026-07-13T09:00:00", stageId: "pre-lodge" }), // no SLA segment
      ],
      slaMap,
      NOW,
    );
    expect(wl.counts.tracked).toBe(0);
  });

  it("skips deals whose lender has no SLA on file", () => {
    const wl = buildSlaWatchlist(
      [deal({ id: "unknown", stageEnteredAt: "2026-07-13T09:00:00", lender: "Westpac" })],
      new Map(), // empty SLA map → expectedDays null → skipped
      NOW,
    );
    expect(wl.counts.tracked).toBe(0);
  });

  it("ranks the most overdue first", () => {
    const wl = buildSlaWatchlist(
      [
        deal({ id: "a", stageEnteredAt: "2026-07-14T09:00:00" }), // 1 over SLA... actually due
        deal({ id: "b", stageEnteredAt: "2026-07-10T09:00:00" }), // further back → more overdue
        deal({ id: "c", stageEnteredAt: "2026-07-13T09:00:00" }),
      ],
      slaMap,
      NOW,
    );
    // b (settled Fri 10 Jul) is the most overdue and must sort first.
    expect(wl.overdue[0].dealId).toBe("b");
    expect(wl.overdue[0].overdueBy).toBeGreaterThan(wl.overdue[1].overdueBy);
  });
});

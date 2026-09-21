import { describe, it, expect } from "vitest";
import { buildStaleDealsReport, buildPriorityReport } from "./internal-reports";
import type { LenderSlaValues } from "./lenders";
import type { Deal } from "./clients/salestrekker/types";

function deal(over: Partial<Deal>): Deal {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Test Client",
    appRef: "MF-1",
    brokerId: "mm",
    stageId: "lodged",
    lender: "Westpac (chosen)",
    nurturedAt: null,
    daysSinceContact: 0,
    priorityFlag: null,
    stageEnteredAt: null,
    pending: [],
    overdue: [],
    ...over,
  } as unknown as Deal;
}

const slaMap = new Map<string, LenderSlaValues>([
  [
    "westpac",
    { purchaseAssessDays: 1, refinanceAssessDays: 1, preApprovalDays: null, formalDays: null },
  ],
]);

describe("buildStaleDealsReport", () => {
  it("lists only active deals not touched in 2+ days, grouped by broker", () => {
    const r = buildStaleDealsReport([
      deal({ name: "Fresh", daysSinceContact: 1 }),
      deal({ name: "Stale A", daysSinceContact: 4 }),
      deal({ name: "Settled", daysSinceContact: 9, stageId: "settled" }),
      deal({ name: "Nurtured", daysSinceContact: 9, nurturedAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(r.count).toBe(1);
    expect(r.body).toContain("Stale A");
    expect(r.body).not.toContain("Fresh");
    expect(r.body).not.toContain("Settled");
    expect(r.body).not.toContain("Nurtured");
  });

  it("gives an all-clear when nothing is stale", () => {
    const r = buildStaleDealsReport([deal({ daysSinceContact: 0 })]);
    expect(r.count).toBe(0);
    expect(r.subject).toMatch(/all deals touched/i);
  });
});

describe("buildPriorityReport", () => {
  it("flags SLA-overdue, settle-booked+outstanding, flagged, and cold deals", () => {
    const r = buildPriorityReport(
      [
        deal({ name: "On track", daysSinceContact: 0 }),
        deal({
          name: "Overdue",
          stageId: "lodged",
          stageEnteredAt: new Date("2020-01-01"),
          daysSinceContact: 0,
        }),
        deal({ name: "SettleRisk", stageId: "settle-booked", pending: ["x"], daysSinceContact: 0 }),
        deal({ name: "Flagged", priorityFlag: "outstanding-action", daysSinceContact: 0 }),
        deal({ name: "Cold", daysSinceContact: 6 }),
      ],
      slaMap,
      new Date("2026-06-10"),
    );
    expect(r.count).toBe(4);
    expect(r.body).toContain("Overdue");
    expect(r.body).toContain("SettleRisk");
    expect(r.body).toContain("Flagged");
    expect(r.body).toContain("Cold");
    expect(r.body).not.toContain("On track");
    // SLA-overdue outranks a merely-cold deal (appears earlier in the body).
    expect(r.body.indexOf("Overdue")).toBeLessThan(r.body.indexOf("Cold"));
  });

  it("gives an all-clear when nothing is flagged", () => {
    const r = buildPriorityReport([deal({ daysSinceContact: 0 })], slaMap, new Date());
    expect(r.count).toBe(0);
    expect(r.subject).toMatch(/nothing flagged/i);
  });
});

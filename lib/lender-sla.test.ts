import { describe, it, expect } from "vitest";
import {
  businessDaysBetween,
  slaForDeal,
  slaStatusForDeal,
} from "./lender-sla";
import type { LenderSlaValues } from "./lenders";
import type { Deal } from "./clients/salestrekker/types";

function deal(over: Partial<Deal>): Deal {
  return {
    stageId: "lodged",
    lender: "Westpac",
    leadCategory: "purchase",
    stageEnteredAt: null,
    ...over,
  } as unknown as Deal;
}

// Westpac -> id "westpac". Use a map override so the test doesn't depend on
// the shipped seed figures.
const slaMap = new Map<string, LenderSlaValues>([
  [
    "westpac",
    { purchaseAssessDays: 5, refinanceAssessDays: 6, preApprovalDays: 2, formalDays: 4 },
  ],
]);

describe("businessDaysBetween", () => {
  it("counts weekdays only", () => {
    // Mon 2026-06-01 -> Mon 2026-06-08 = 5 business days.
    expect(
      businessDaysBetween(new Date("2026-06-01"), new Date("2026-06-08")),
    ).toBe(5);
  });
  it("is 0 for same or reversed dates", () => {
    expect(businessDaysBetween(new Date("2026-06-08"), new Date("2026-06-01"))).toBe(0);
    expect(businessDaysBetween(new Date("2026-06-01"), new Date("2026-06-01"))).toBe(0);
  });
});

describe("slaForDeal", () => {
  it("resolves the selected lender's SLA from the deal.lender name", () => {
    expect(slaForDeal(deal({ lender: "Westpac (chosen)" }), slaMap).purchaseAssessDays).toBe(5);
  });
  it("returns empty SLA when lender is unset or unknown", () => {
    expect(slaForDeal(deal({ lender: "TBC" }), slaMap).purchaseAssessDays).toBeNull();
    expect(slaForDeal(deal({ lender: "Nonexistent Bank" }), slaMap).purchaseAssessDays).toBeNull();
  });
});

describe("slaStatusForDeal", () => {
  it("flags a lodged purchase overdue once past the purchase assessment SLA", () => {
    // Lodged 7 business days ago, purchase assess SLA is 5 -> overdue by 2.
    const s = slaStatusForDeal(
      deal({ stageId: "lodged", leadCategory: "purchase", stageEnteredAt: new Date("2026-06-01") }),
      slaMap,
      new Date("2026-06-10"), // Mon->Wed next week = 7 business days
    );
    expect(s.key).toBe("purchaseAssessDays");
    expect(s.expectedDays).toBe(5);
    expect(s.daysInStage).toBe(7);
    expect(s.overdue).toBe(true);
    expect(s.overdueBy).toBe(2);
  });

  it("uses the refinance SLA for a lodged refinance", () => {
    const s = slaStatusForDeal(
      deal({ stageId: "lodged", leadCategory: "refinance", stageEnteredAt: new Date("2026-06-08") }),
      slaMap,
      new Date("2026-06-10"),
    );
    expect(s.key).toBe("refinanceAssessDays");
    expect(s.expectedDays).toBe(6);
  });

  it("is not overdue while within the SLA window", () => {
    const s = slaStatusForDeal(
      deal({ stageId: "lodged", stageEnteredAt: new Date("2026-06-08") }),
      slaMap,
      new Date("2026-06-10"), // 2 business days, SLA 5
    );
    expect(s.overdue).toBe(false);
  });

  it("uses the formal SLA for a conditionally-approved deal", () => {
    const s = slaStatusForDeal(
      deal({ stageId: "cond-approved", stageEnteredAt: new Date("2026-06-01") }),
      slaMap,
      new Date("2026-06-10"),
    );
    expect(s.key).toBe("formalDays");
    expect(s.expectedDays).toBe(4);
    expect(s.overdue).toBe(true);
  });

  it("uses the pre-approval SLA at the pre-approval stage", () => {
    const s = slaStatusForDeal(deal({ stageId: "pre-approval" }), slaMap);
    expect(s.key).toBe("preApprovalDays");
    expect(s.expectedDays).toBe(2);
  });

  it("returns no metric for stages with no lender-side wait", () => {
    const s = slaStatusForDeal(deal({ stageId: "settle-booked" }), slaMap);
    expect(s.key).toBeNull();
    expect(s.overdue).toBe(false);
  });

  it("never overdue when the lender has no SLA figures", () => {
    const s = slaStatusForDeal(
      deal({ stageId: "lodged", lender: "Firstmac", stageEnteredAt: new Date("2020-01-01") }),
      new Map(), // empty map => no figures
      new Date("2026-06-10"),
    );
    expect(s.expectedDays).toBeNull();
    expect(s.overdue).toBe(false);
  });
});

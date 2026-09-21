import { describe, it, expect } from "vitest";
import { slaCustomerSentence, slaInternalNote } from "./sla-comms";
import type { DealSlaStatus } from "./lender-sla";
import type { Deal } from "./clients/salestrekker/types";

function deal(lender = "Westpac (chosen)"): Deal {
  return { lender } as unknown as Deal;
}

function status(over: Partial<DealSlaStatus>): DealSlaStatus {
  return {
    key: "purchaseAssessDays",
    label: "Assessment",
    customerTask: "assessment",
    expectedDays: 5,
    daysInStage: 2,
    overdue: false,
    overdueBy: 0,
    ...over,
  };
}

describe("slaCustomerSentence", () => {
  it("gives a soft, dateless expectation when on track", () => {
    const s = slaCustomerSentence(deal(), status({ daysInStage: 2 }))!;
    expect(s).toContain("Westpac");
    expect(s).toContain("around 5 business days");
    expect(s).toMatch(/expect to hear back/);
    // Soft, not a hard promise / date.
    expect(s).not.toMatch(/\bwill\b/);
  });

  it("frames an overdue deal as us chasing, not a failure", () => {
    const s = slaCustomerSentence(deal(), status({ overdue: true, daysInStage: 8, overdueBy: 3 }))!;
    expect(s).toMatch(/following up with them directly/);
    expect(s).not.toMatch(/late|failed|delay|sorry/i);
  });

  it("returns null when the lender has no SLA figures", () => {
    expect(slaCustomerSentence(deal(), status({ expectedDays: null }))).toBeNull();
    expect(slaCustomerSentence(deal(), status({ key: null, customerTask: null }))).toBeNull();
  });
});

describe("slaInternalNote", () => {
  it("is compact and flags overdue", () => {
    expect(slaInternalNote(status({ daysInStage: 2 }))).toBe(
      "Assessment: 2bd in vs 5bd SLA",
    );
    expect(slaInternalNote(status({ overdue: true, daysInStage: 8, overdueBy: 3 }))).toBe(
      "Assessment: 8bd in vs 5bd SLA (3bd over)",
    );
  });
  it("is null without figures", () => {
    expect(slaInternalNote(status({ expectedDays: null }))).toBeNull();
  });
});

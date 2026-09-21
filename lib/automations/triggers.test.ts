import { describe, it, expect } from "vitest";
import { daysInStage, describeTrigger, evaluateTrigger, isAnniversaryDue } from "./triggers";
import type { SettlementRow } from "@/lib/commission-parser";
import type { Deal } from "@/lib/clients/salestrekker/types";

const TODAY = new Date("2026-08-25T09:00:00");

function settlement(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: "L-1",
    brokerName: "Michael Mankin",
    brokerId: "mm",
    clientName: "Sarah Chen",
    email: "sarah@example.com",
    lender: "ANZ",
    lenderCode: "ANZ",
    loanId: "L-1",
    settlementDate: "2025-08-25",
    settlementAmount: 640000,
    currentBalance: 610000,
    upfrontCommission: 4000,
    monthlyTrail: 90,
    loanStatus: "active",
    dischargeDate: null,
    source: { onUpfront: true, onTrail: true, onClawback: false },
    ...over,
  };
}

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "D-1",
    name: "Tom Reilly",
    email: "tom@example.com",
    brokerId: "mm",
    stageId: "pre-approval",
    lender: "Westpac",
    stageEnteredAt: new Date("2026-06-01"),
    excludeFromDailyUpdates: false,
    ...over,
  } as unknown as Deal;
}

const base = {
  today: TODAY,
  alreadyEnrolled: new Set<string>(),
  suppressed: new Set<string>(),
  fieldsForSettlement: (s: SettlementRow) => ({ first_name: s.clientName.split(" ")[0] }),
  fieldsForDeal: (d: Deal) => ({ first_name: d.name.split(" ")[0] }),
};

describe("isAnniversaryDue", () => {
  it("is due on the day", () => {
    expect(isAnniversaryDue("2025-08-25", 12, TODAY)).toBe(true);
  });

  it("catches up on a day the cron missed", () => {
    // Two days late still enrols — otherwise an outage silently drops a
    // whole day's cohort and nobody ever finds out.
    expect(isAnniversaryDue("2025-08-23", 12, TODAY)).toBe(true);
  });

  it("does not fire early", () => {
    expect(isAnniversaryDue("2025-08-28", 12, TODAY)).toBe(false);
  });

  it("does not fire again long afterwards", () => {
    expect(isAnniversaryDue("2025-06-25", 12, TODAY)).toBe(false);
  });

  it("ignores an unparseable date", () => {
    expect(isAnniversaryDue("", 12, TODAY)).toBe(false);
  });
});

describe("evaluateTrigger — settlement anniversary", () => {
  const trigger = { kind: "settlement-anniversary" as const, months: 12 };

  it("enrols a loan on its anniversary", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [settlement()],
      deals: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].email).toBe("sarah@example.com");
    expect(hits[0].fields.first_name).toBe("Sarah");
  });

  it("leaves a discharged loan alone", () => {
    // Its anniversary is not an occasion to write about reviewing it.
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [settlement({ loanStatus: "discharged" })],
      deals: [],
    });
    expect(hits).toEqual([]);
  });

  it("never enrols the same person twice", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [settlement()],
      deals: [],
      alreadyEnrolled: new Set(["sarah@example.com"]),
    });
    expect(hits).toEqual([]);
  });

  it("respects the do-not-market register at entry, not just at send", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [settlement()],
      deals: [],
      suppressed: new Set(["sarah@example.com"]),
    });
    expect(hits).toEqual([]);
  });
});

describe("evaluateTrigger — pipeline stage", () => {
  const trigger = {
    kind: "pipeline-stage" as const,
    stageId: "pre-approval",
    afterDays: 60,
  };

  it("enrols a deal that has sat long enough", () => {
    const hits = evaluateTrigger({ ...base, trigger, settlements: [], deals: [deal()] });
    expect(hits).toHaveLength(1);
  });

  it("waits until the deal has been there long enough", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [],
      deals: [deal({ stageEnteredAt: new Date("2026-08-20") })],
    });
    expect(hits).toEqual([]);
  });

  it("ignores a deal in a different stage", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [],
      deals: [deal({ stageId: "settled" })],
    });
    expect(hits).toEqual([]);
  });

  it("honours the per-deal exclude switch", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger,
      settlements: [],
      deals: [deal({ excludeFromDailyUpdates: true })],
    });
    expect(hits).toEqual([]);
  });
});

describe("daysInStage", () => {
  it("counts whole days since the stage was entered", () => {
    expect(daysInStage(deal({ stageEnteredAt: new Date("2026-08-20") }), TODAY)).toBe(5);
  });

  it("is null when nothing recorded the transition", () => {
    expect(daysInStage(deal({ stageEnteredAt: null }), TODAY)).toBeNull();
  });
});

describe("describeTrigger", () => {
  it("reads as a sentence", () => {
    expect(describeTrigger({ kind: "settlement-anniversary", months: 12 })).toBe(
      "A loan passes its 12-month settlement anniversary",
    );
    expect(
      describeTrigger(
        { kind: "pipeline-stage", stageId: "pre-approval", afterDays: 60 },
        "Pre-Approval Only",
      ),
    ).toBe("A deal has been at Pre-Approval Only for 60 days");
  });
});

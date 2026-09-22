import { describe, it, expect } from "vitest";
import {
  daysInStage,
  describeTrigger,
  evaluateTrigger,
  isAnniversaryDue,
  percentPaidDown,
  type SubmissionHit,
  type TagHit,
} from "./triggers";
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

/* -------------------------------------------------------------------------- */
/* The triggers added for Mailchimp parity                                    */
/* -------------------------------------------------------------------------- */

describe("the form-submission trigger", () => {
  const submission = (over: Partial<SubmissionHit> = {}): SubmissionHit => ({
    formId: "F-1",
    email: "new@example.com",
    name: "Jess Waller",
    submittedAt: new Date("2026-08-24T10:00:00"),
    dealId: null,
    ...over,
  });

  it("enrols someone who enquired through the named form", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [],
      submissions: [submission()],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].email).toBe("new@example.com");
  });

  it("ignores enquiries from a different form", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [],
      submissions: [submission({ formId: "F-2" })],
    });
    expect(hits).toEqual([]);
  });

  it("enrols even when the enquiry never became a deal", () => {
    // A welcome sequence should not be contingent on the pipeline
    // write having succeeded — that failure is ours, not theirs.
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [],
      submissions: [submission({ dealId: null })],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].firstName).toBe("Jess");
    expect(hits[0].fields).toEqual({});
  });

  it("uses the deal's merge context when there is one", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [deal({ id: "D-9", name: "Tom Reilly", email: "new@example.com" })],
      submissions: [submission({ dealId: "D-9" })],
    });
    expect(hits[0].name).toBe("Tom Reilly");
    expect(hits[0].firstName).toBe("Tom");
    expect(hits[0].sourceId).toBe("D-9");
  });

  it("never enrols someone already in the sequence", () => {
    const hits = evaluateTrigger({
      ...base,
      alreadyEnrolled: new Set(["new@example.com"]),
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [],
      submissions: [submission()],
    });
    expect(hits).toEqual([]);
  });

  it("never enrols a suppressed address", () => {
    const hits = evaluateTrigger({
      ...base,
      suppressed: new Set(["new@example.com"]),
      trigger: { kind: "form-submission", formId: "F-1" },
      settlements: [],
      deals: [],
      submissions: [submission()],
    });
    expect(hits).toEqual([]);
  });
});

describe("the tag-added trigger", () => {
  const tagged = (over: Partial<TagHit> = {}): TagHit => ({
    email: "sarah@example.com",
    tag: "Refinance watch",
    addedAt: new Date("2026-08-24T10:00:00"),
    ...over,
  });

  it("matches the tag regardless of case", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "tag-added", tag: "refinance WATCH" },
      settlements: [settlement()],
      deals: [],
      tagEvents: [tagged()],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceKind).toBe("settlements");
  });

  it("ignores a different tag", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "tag-added", tag: "VIP" },
      settlements: [settlement()],
      deals: [],
      tagEvents: [tagged()],
    });
    expect(hits).toEqual([]);
  });

  it("prefers the back-book record when the contact is in both", () => {
    // Same precedence the subscriber list and the audience resolver
    // use, so the merge context is the richer one.
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "tag-added", tag: "Refinance watch" },
      settlements: [settlement()],
      deals: [deal({ email: "sarah@example.com" })],
      tagEvents: [tagged()],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceKind).toBe("settlements");
  });

  it("falls back to the pipeline for a contact with no settlement", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "tag-added", tag: "Refinance watch" },
      settlements: [],
      deals: [deal({ email: "sarah@example.com" })],
      tagEvents: [tagged()],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceKind).toBe("deals");
  });

  it("skips a tag on someone in neither dataset", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "tag-added", tag: "Refinance watch" },
      settlements: [],
      deals: [],
      tagEvents: [tagged({ email: "ghost@example.com" })],
    });
    expect(hits).toEqual([]);
  });
});

describe("percentPaidDown", () => {
  it("measures progress against what the loan started at", () => {
    expect(percentPaidDown({ settlementAmount: 400000, currentBalance: 300000 }))
      .toBeCloseTo(25);
  });

  it("is unknown rather than complete when there is no starting balance", () => {
    // Zero would read as a fully repaid loan and fire every milestone.
    expect(percentPaidDown({ settlementAmount: 0, currentBalance: 0 })).toBeNull();
  });

  it("reads a redraw as no progress rather than negative progress", () => {
    expect(percentPaidDown({ settlementAmount: 400000, currentBalance: 430000 })).toBe(0);
  });
});

describe("the equity-milestone trigger", () => {
  it("fires once a loan passes the threshold", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "equity-milestone", percentPaidDown: 25 },
      settlements: [settlement({ settlementAmount: 400000, currentBalance: 290000 })],
      deals: [],
    });
    expect(hits).toHaveLength(1);
  });

  it("does not fire below it", () => {
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "equity-milestone", percentPaidDown: 25 },
      settlements: [settlement({ settlementAmount: 400000, currentBalance: 320000 })],
      deals: [],
    });
    expect(hits).toEqual([]);
  });

  it("ignores a loan that has refinanced away", () => {
    // Its balance is zero, which would otherwise read as 100% paid
    // down and send a milestone email about a loan we no longer hold.
    const hits = evaluateTrigger({
      ...base,
      trigger: { kind: "equity-milestone", percentPaidDown: 25 },
      settlements: [
        settlement({
          loanStatus: "discharged",
          settlementAmount: 400000,
          currentBalance: 0,
        }),
      ],
      deals: [],
    });
    expect(hits).toEqual([]);
  });
});

describe("describeTrigger for the new kinds", () => {
  it("names the form when it knows it", () => {
    expect(
      describeTrigger({ kind: "form-submission", formId: "F-1" }, undefined, "Rate enquiry"),
    ).toBe("Someone enquires through Rate enquiry");
  });

  it("falls back to 'a form' when it does not", () => {
    expect(describeTrigger({ kind: "form-submission", formId: "F-1" })).toMatch(/a form/);
  });

  it("quotes the tag", () => {
    expect(describeTrigger({ kind: "tag-added", tag: "VIP" })).toBe(
      'A contact is tagged "VIP"',
    );
  });

  it("describes an unset tag as a choice, not as empty quotes", () => {
    // This is what a template card shows before the broker picks one.
    expect(describeTrigger({ kind: "tag-added", tag: "" })).toBe(
      "A contact is tagged with a label you choose",
    );
    expect(describeTrigger({ kind: "tag-added", tag: "  " })).not.toMatch(/""/);
  });

  it("states the milestone", () => {
    expect(describeTrigger({ kind: "equity-milestone", percentPaidDown: 25 })).toBe(
      "A loan passes 25% paid down",
    );
  });
});

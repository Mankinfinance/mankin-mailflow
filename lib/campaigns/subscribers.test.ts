import { describe, it, expect } from "vitest";
import {
  buildActivity,
  buildSubscribers,
  countSubscribers,
  filterSubscribers,
} from "./subscribers";
import type { SettlementRow } from "@/lib/commission-parser";
import type { Deal } from "@/lib/clients/salestrekker/types";
import type {
  CampaignRecipientRow,
  EmailSuppressionRow,
} from "@/lib/db/schema";

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
    settlementDate: "2023-03-14",
    settlementAmount: 640000,
    currentBalance: 612400,
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
    brokerId: "na",
    stageId: "lodged",
    lender: "Westpac",
    loanAmount: 500000,
    systemAddedAt: "2026-07-02T00:00:00.000Z",
    nurturedAt: null,
    ...over,
  } as unknown as Deal;
}

function suppression(over: Partial<EmailSuppressionRow> = {}): EmailSuppressionRow {
  return {
    email: "sarah@example.com",
    createdAt: new Date("2026-08-12"),
    reason: "unsubscribe",
    campaignId: null,
    addedBy: "customer",
    ...over,
  } as EmailSuppressionRow;
}

describe("buildSubscribers", () => {
  it("combines both datasets with their loan context", () => {
    const list = buildSubscribers({
      settlements: [settlement()],
      deals: [deal()],
      suppressions: [],
    });
    expect(list).toHaveLength(2);

    const backBook = list.find((s) => s.source === "back-book")!;
    expect(backBook.loan.lender).toBe("ANZ");
    expect(backBook.loan.currentBalance).toBe(612_400);
    expect(backBook.since).toBe("2023-03-14");

    const pipeline = list.find((s) => s.source === "pipeline")!;
    expect(pipeline.loan.stageId).toBe("lodged");
    expect(pipeline.since).toBe("2026-07-02");
  });

  it("keeps the back-book record when someone is in both", () => {
    const list = buildSubscribers({
      settlements: [settlement({ email: "Sarah@Example.com" })],
      deals: [deal({ email: "sarah@example.com" })],
      suppressions: [],
    });
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe("back-book");
    expect(list[0].email).toBe("sarah@example.com");
  });

  it("reads status off the register, distinguishing a bounce from an opt-out", () => {
    const list = buildSubscribers({
      settlements: [
        settlement({ id: "a", email: "a@example.com" }),
        settlement({ id: "b", email: "b@example.com" }),
        settlement({ id: "c", email: "c@example.com" }),
      ],
      deals: [],
      suppressions: [
        suppression({ email: "a@example.com", reason: "unsubscribe" }),
        suppression({ email: "b@example.com", reason: "bounce" }),
      ],
    });
    const byEmail = new Map(list.map((s) => [s.email, s.status]));
    expect(byEmail.get("a@example.com")).toBe("unsubscribed");
    expect(byEmail.get("b@example.com")).toBe("bounced");
    expect(byEmail.get("c@example.com")).toBe("active");
  });

  it("drops records with no email — they can never be a contact", () => {
    const list = buildSubscribers({
      settlements: [settlement({ email: "" })],
      deals: [deal({ email: "  " })],
      suppressions: [],
    });
    expect(list).toEqual([]);
  });
});

describe("filterSubscribers", () => {
  const list = buildSubscribers({
    settlements: [settlement()],
    deals: [deal()],
    suppressions: [suppression()],
  });

  it("searches name and email together", () => {
    expect(filterSubscribers(list, { search: "sarah" })).toHaveLength(1);
    expect(filterSubscribers(list, { search: "tom@example" })).toHaveLength(1);
    expect(filterSubscribers(list, { search: "REILLY" })).toHaveLength(1);
    expect(filterSubscribers(list, { search: "nobody" })).toHaveLength(0);
  });

  it("filters by source and status", () => {
    expect(filterSubscribers(list, { source: "pipeline" })).toHaveLength(1);
    expect(filterSubscribers(list, { status: "unsubscribed" })).toHaveLength(1);
    expect(filterSubscribers(list, { status: "all", source: "all" })).toHaveLength(2);
  });
});

describe("countSubscribers", () => {
  it("counts each status and source", () => {
    const counts = countSubscribers(
      buildSubscribers({
        settlements: [settlement()],
        deals: [deal()],
        suppressions: [suppression()],
      }),
    );
    expect(counts).toEqual({
      active: 1,
      unsubscribed: 1,
      bounced: 0,
      backBook: 1,
      pipeline: 1,
    });
  });
});

describe("buildActivity", () => {
  const subscriber = buildSubscribers({
    settlements: [settlement()],
    deals: [],
    suppressions: [],
  })[0];

  function recipient(over: Partial<CampaignRecipientRow> = {}): CampaignRecipientRow {
    return {
      id: "r1",
      campaignId: "c1",
      email: "sarah@example.com",
      name: "Sarah Chen",
      firstName: "Sarah",
      sourceKind: "settlements",
      sourceId: "L-1",
      fields: {},
      status: "sent",
      skipReason: null,
      error: null,
      sentAt: new Date("2026-08-12T09:05:00Z"),
      openedAt: new Date("2026-08-12T11:00:00Z"),
      clickedAt: null,
      unsubscribedAt: null,
      ...over,
    } as CampaignRecipientRow;
  }

  it("returns one event per timestamp, newest first, named by campaign", () => {
    const events = buildActivity(
      subscriber,
      [recipient()],
      new Map([["c1", "2023 fixed-rate expiries"]]),
    );
    expect(events.map((e) => e.kind)).toEqual(["opened", "sent", "added"]);
    expect(events[0].label).toBe("2023 fixed-rate expiries");
    // The oldest event is always how they entered the book.
    expect(events[events.length - 1].kind).toBe("added");
  });

  it("ignores recipient rows belonging to somebody else", () => {
    const events = buildActivity(
      subscriber,
      [recipient({ email: "someone-else@example.com" })],
      new Map(),
    );
    expect(events.map((e) => e.kind)).toEqual(["added"]);
  });
});

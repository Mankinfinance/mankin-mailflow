import { describe, it, expect } from "vitest";
import {
  buildContactSeries,
  buildMonthRows,
  countSince,
  holdAxis,
  isComplaintRateAtRisk,
} from "./dashboard";
import type { CampaignRow, CampaignRecipientRow } from "@/lib/db/schema";

function campaign(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "c1",
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
    name: "Rate note",
    subject: "s",
    body: "b",
    status: "sent",
    audience: {},
    fromBrokerId: "mm",
    createdBy: "mm",
    scheduledFor: null,
    startedAt: new Date("2026-08-12T09:04:00Z"),
    completedAt: null,
    trackOpens: true,
    trackClicks: true,
    ...over,
  } as CampaignRow;
}

function recipient(over: Partial<CampaignRecipientRow> = {}): CampaignRecipientRow {
  return {
    id: "r1",
    campaignId: "c1",
    email: "a@example.com",
    name: "A",
    firstName: "A",
    sourceKind: "settlements",
    sourceId: "s1",
    fields: {},
    status: "sent",
    skipReason: null,
    error: null,
    sentAt: new Date("2026-08-12T09:05:00Z"),
    openedAt: null,
    clickedAt: null,
    unsubscribedAt: null,
    ...over,
  } as CampaignRecipientRow;
}

describe("holdAxis", () => {
  it("holds a minimum window so a two-contact dip is not a cliff", () => {
    // This is the failure in the tool being replaced: 795 → 793 rendered
    // against an auto domain looks catastrophic.
    const { min, max } = holdAxis([795, 795, 794, 793, 795, 796]);
    expect(max - min).toBe(10);
    expect(min).toBeLessThanOrEqual(793);
    expect(max).toBeGreaterThanOrEqual(796);
  });

  it("lets a genuinely large movement use its own scale", () => {
    const { min, max } = holdAxis([100, 400]);
    expect(max - min).toBeGreaterThan(300);
  });

  it("survives an empty series", () => {
    expect(holdAxis([])).toEqual({ min: 0, max: 10 });
  });
});

describe("buildContactSeries", () => {
  const now = new Date("2026-08-25T10:00:00");

  it("walks backwards, adding opt-outs back as it goes", () => {
    const series = buildContactSeries(795, [new Date("2026-08-22T09:00:00")], {
      days: 5,
      now,
    });
    // Today's figure is the one we actually know.
    expect(series.points[series.points.length - 1].contacts).toBe(795);
    // Before the 22nd, that person was still a contact.
    expect(series.points[0].contacts).toBe(796);
  });

  it("produces a flat series when nobody opted out", () => {
    const series = buildContactSeries(795, [], { days: 30, now });
    expect(new Set(series.points.map((p) => p.contacts))).toEqual(new Set([795]));
    // And the axis still spans a sensible window rather than collapsing.
    expect(series.max - series.min).toBe(10);
  });
});

describe("buildMonthRows", () => {
  const now = new Date("2026-08-25");

  it("buckets a campaign into the month it was sent", () => {
    const rows = buildMonthRows(
      [campaign()],
      new Map([["c1", [recipient(), recipient({ id: "r2", openedAt: new Date() })]]]),
      { months: 3, now },
    );
    expect(rows[0].label).toBe("Aug 2026");
    expect(rows[0].campaigns).toBe(1);
    expect(rows[0].emailsSent).toBe(2);
    expect(rows[0].opened).toBe(1);
  });

  it("counts only recipients that were actually sent to", () => {
    const rows = buildMonthRows(
      [campaign()],
      new Map([
        [
          "c1",
          [recipient(), recipient({ id: "r2", status: "skipped", sentAt: null })],
        ],
      ]),
      { months: 3, now },
    );
    expect(rows[0].emailsSent).toBe(1);
  });

  it("leaves the complaint rate null rather than inventing a zero", () => {
    const rows = buildMonthRows([campaign()], new Map([["c1", [recipient()]]]), {
      months: 3,
      now,
    });
    // Graph gives us no feedback loop, so we do not claim to know.
    expect(rows[0].complaintRate).toBeNull();
    expect(isComplaintRateAtRisk(rows[0].complaintRate)).toBe(false);
  });

  it("returns the requested months newest first, including empty ones", () => {
    const rows = buildMonthRows([], new Map(), { months: 6, now });
    expect(rows).toHaveLength(6);
    expect(rows[0].label).toBe("Aug 2026");
    expect(rows[5].label).toBe("Mar 2026");
    expect(rows.every((r) => r.emailsSent === 0)).toBe(true);
  });

  it("ignores a campaign that has never been sent", () => {
    const rows = buildMonthRows([campaign({ startedAt: null })], new Map(), {
      months: 3,
      now,
    });
    expect(rows.every((r) => r.campaigns === 0)).toBe(true);
  });
});

describe("isComplaintRateAtRisk", () => {
  it("flags at and above one in a thousand", () => {
    expect(isComplaintRateAtRisk(0.0012)).toBe(true);
    expect(isComplaintRateAtRisk(0.001)).toBe(true);
    expect(isComplaintRateAtRisk(0.0006)).toBe(false);
  });
});

describe("countSince", () => {
  it("counts only what falls inside the window", () => {
    const dates = [new Date("2026-08-20"), new Date("2026-07-01")];
    expect(countSince(dates, new Date("2026-08-01"))).toBe(1);
  });
});

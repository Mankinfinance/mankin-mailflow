import { describe, it, expect } from "vitest";
import {
  buildMilestoneQueue,
  handledKeysFromEvents,
  milestoneKey,
} from "./milestone-queue";
import type { Deal, StageId } from "./clients/salestrekker/types";

const NOW = new Date("2026-07-15T12:00:00Z");

function deal(p: {
  id: string;
  stageId: StageId;
  nurturedAt?: string | null;
  settledOn?: string | null;
  stageEnteredAt?: Date | null;
}): Deal {
  return {
    id: p.id,
    name: `Client ${p.id}`,
    brokerId: "mm",
    stageId: p.stageId,
    nurturedAt: p.nurturedAt ?? null,
    settledOn: p.settledOn ?? null,
    stageEnteredAt: p.stageEnteredAt ?? null,
  } as unknown as Deal;
}

describe("buildMilestoneQueue", () => {
  it("queues active deals in a milestone stage that aren't handled yet", () => {
    const q = buildMilestoneQueue(
      [
        deal({ id: "formal", stageId: "unconditional" }),
        deal({ id: "cond", stageId: "cond-approved" }),
        deal({ id: "prelodge", stageId: "pre-lodge" }), // no stage comms
        deal({ id: "parked", stageId: "unconditional", nurturedAt: "2026-01-01" }),
      ],
      new Set([milestoneKey("cond", "cond-approved")]), // cond already handled
      NOW,
    );
    expect(q.map((i) => i.dealId)).toEqual(["formal"]);
    expect(q[0].label).toBe("Formal approval");
  });

  it("queues a fresh settlement but not an old one", () => {
    const q = buildMilestoneQueue(
      [
        deal({ id: "fresh", stageId: "settled", settledOn: "2026-07-10" }), // 5 days
        deal({ id: "stale", stageId: "settled", settledOn: "2026-05-01" }), // >14 days
        deal({ id: "nodate", stageId: "settled", settledOn: null }),
      ],
      new Set(),
      NOW,
    );
    expect(q.map((i) => i.dealId)).toEqual(["fresh"]);
  });

  it("orders the freshest goodwill first (settled before approval stages)", () => {
    const q = buildMilestoneQueue(
      [
        deal({ id: "a", stageId: "cond-approved" }),
        deal({ id: "b", stageId: "settled", settledOn: "2026-07-14" }),
        deal({ id: "c", stageId: "settle-booked" }),
      ],
      new Set(),
      NOW,
    );
    expect(q.map((i) => i.stageId)).toEqual(["settled", "settle-booked", "cond-approved"]);
  });
});

describe("daysWaiting", () => {
  it("computes days at the milestone and sorts the longest-waiting first within a stage", () => {
    const q = buildMilestoneQueue(
      [
        deal({ id: "fresh", stageId: "unconditional", stageEnteredAt: new Date("2026-07-14T00:00:00Z") }), // 1d
        deal({ id: "stale", stageId: "unconditional", stageEnteredAt: new Date("2026-07-10T00:00:00Z") }), // 5d
      ],
      new Set(),
      NOW,
    );
    expect(q.map((i) => i.dealId)).toEqual(["stale", "fresh"]); // longest-waiting first
    expect(q[0].daysWaiting).toBe(5);
    expect(q[1].daysWaiting).toBe(1);
  });
});

describe("handledKeysFromEvents", () => {
  it("collects deal:stage keys from audit events and ignores malformed ones", () => {
    const keys = handledKeysFromEvents([
      { dealId: "d1", meta: { stageId: "unconditional", state: "emailed" } },
      { dealId: "d2", meta: { stageId: "settled", state: "dismissed" } },
      { dealId: null, meta: { stageId: "settled" } }, // no deal
      { dealId: "d3", meta: null }, // no stage
    ]);
    expect(keys.has(milestoneKey("d1", "unconditional"))).toBe(true);
    expect(keys.has(milestoneKey("d2", "settled"))).toBe(true);
    expect(keys.size).toBe(2);
  });
});

import { describe, it, expect } from "vitest";
import { buildWorkerAgenda, summariseTeamAgendas } from "./worker-agenda";
import type { Deal, StageId } from "./clients/salestrekker/types";

const NOW = new Date("2026-07-15T12:00:00"); // Wednesday

function deal(p: {
  id: string;
  brokerId?: string;
  associateId?: string;
  stageId?: StageId;
  daysSinceContact?: number;
  overdue?: string[];
  settlement?: string;
  preApprovalExpiry?: string | null;
  nurturedAt?: string | null;
}): Deal {
  return {
    id: p.id,
    name: `Client ${p.id}`,
    brokerId: p.brokerId ?? "mm",
    associateId: p.associateId ?? "",
    stageId: p.stageId ?? "lodged",
    daysSinceContact: p.daysSinceContact ?? 0,
    lastContactAt: null,
    overdue: p.overdue ?? [],
    settlement: p.settlement ?? "TBD",
    settledOn: null,
    preApprovalExpiry: p.preApprovalExpiry ?? null,
    nurturedAt: p.nurturedAt ?? null,
    leadCategory: "purchase",
    lender: "Westpac (proposed)",
  } as unknown as Deal;
}

describe("buildWorkerAgenda", () => {
  const deals = [
    deal({ id: "A", daysSinceContact: 10, overdue: ["payslip"] }), // follow-up overdue + docs overdue
    deal({ id: "B", daysSinceContact: 4 }), // follow-up due today (4 == cadence)
    deal({ id: "C", stageId: "pre-approval", daysSinceContact: 0, preApprovalExpiry: "2026-07-16" }), // follow-up in 4d + pre-approval tomorrow
    deal({ id: "D", brokerId: "na", daysSinceContact: 10 }), // other owner
    deal({ id: "E", stageId: "settled", daysSinceContact: 10 }), // settled
    deal({ id: "F", nurturedAt: "2026-01-01", daysSinceContact: 10 }), // parked
  ];
  const agenda = buildWorkerAgenda(deals, "mm", NOW);

  it("buckets a worker's items into overdue / today / this week", () => {
    expect(agenda.counts).toEqual({ overdue: 2, today: 1, week: 2, total: 5 });
  });

  it("puts an overdue follow-up and chased docs in Overdue", () => {
    const ids = agenda.overdue.map((i) => i.id);
    expect(ids).toContain("A:followup");
    expect(ids).toContain("A:docs");
    expect(agenda.overdue.find((i) => i.id === "A:followup")!.relLabel).toContain("ago");
  });

  it("puts a cadence-due follow-up in Due today", () => {
    expect(agenda.today.map((i) => i.id)).toEqual(["B:followup"]);
    expect(agenda.today[0].relLabel).toBe("today");
  });

  it("puts an upcoming follow-up and pre-approval expiry in This week", () => {
    const week = agenda.week.map((i) => i.id);
    expect(week).toContain("C:followup");
    expect(week).toContain("C:preapproval");
    const pa = agenda.week.find((i) => i.id === "C:preapproval")!;
    expect(pa.kind).toBe("Date");
    expect(pa.relLabel).toBe("tomorrow");
  });

  it("excludes other owners, settled, and nurtured deals", () => {
    const allIds = [...agenda.overdue, ...agenda.today, ...agenda.week].map((i) => i.dealId);
    expect(allIds).not.toContain("D");
    expect(allIds).not.toContain("E");
    expect(allIds).not.toContain("F");
  });

  it("labels the context line from loan type and lender", () => {
    expect(agenda.overdue[0].context).toBe("Purchase · Westpac");
  });

  it("includes deals a worker supports as associate, not just owns", () => {
    const supported = buildWorkerAgenda(
      [deal({ id: "S", brokerId: "mm", associateId: "mp", daysSinceContact: 10 })],
      "mp",
      NOW,
    );
    expect(supported.overdue.some((i) => i.dealId === "S")).toBe(true);
  });
});

describe("stage-aware cadence + SLA items", () => {
  it("chases new (pre-lodge) leads faster than lender-stage deals", () => {
    // dsc 2: pre-lodge (cadence 2) is due today; lodged (cadence 4) is later.
    const newLead = buildWorkerAgenda([deal({ id: "N", stageId: "pre-lodge", daysSinceContact: 2 })], "mm", NOW);
    expect(newLead.today.some((i) => i.id === "N:followup")).toBe(true);

    const lenderStage = buildWorkerAgenda([deal({ id: "L", stageId: "lodged", daysSinceContact: 2 })], "mm", NOW);
    expect(lenderStage.today.some((i) => i.id === "L:followup")).toBe(false);
    expect(lenderStage.week.some((i) => i.id === "L:followup")).toBe(true);
  });

  it("adds a lender-SLA deadline item when the page supplies one", () => {
    const slaDue = new Map([["S", { label: "Assessment", date: new Date("2026-07-17") }]]);
    const a = buildWorkerAgenda(
      [deal({ id: "S", stageId: "lodged", daysSinceContact: 0 })],
      "mm",
      NOW,
      slaDue,
    );
    const sla = [...a.overdue, ...a.today, ...a.week].find((i) => i.id === "S:sla");
    expect(sla).toBeTruthy();
    expect(sla!.kind).toBe("Date");
    expect(sla!.title.toLowerCase()).toContain("lender sla");
  });
});

describe("summariseTeamAgendas", () => {
  it("rolls up counts per worker, most-overdue first", () => {
    const deals = [
      deal({ id: "a1", brokerId: "mm", daysSinceContact: 10 }), // mm overdue
      deal({ id: "a2", brokerId: "mm", daysSinceContact: 12 }), // mm overdue
      deal({ id: "b1", brokerId: "na", daysSinceContact: 10 }), // na overdue
    ];
    const rows = summariseTeamAgendas(deals, ["na", "mm"], NOW);
    expect(rows[0].memberId).toBe("mm"); // 2 overdue > 1
    expect(rows[0].overdue).toBe(2);
    expect(rows[0].topOverdue).toBe("Follow up with client");
    expect(rows[1].memberId).toBe("na");
  });
});

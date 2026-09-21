import { describe, it, expect } from "vitest";
import {
  buildBrokerLeaderboard,
  buildBrokerTrend,
} from "./broker-leaderboard";
import type { Deal } from "./clients/salestrekker/types";
import type { TeamMember } from "./team";

function broker(id: string, short: string): TeamMember {
  return { id, short, name: short, role: "Finance Broker" } as unknown as TeamMember;
}

function deal(p: {
  brokerId: string;
  stageId: Deal["stageId"];
  loanAmount?: number | null;
  nurturedAt?: string | null;
  settledOn?: string | null;
}): Deal {
  return {
    brokerId: p.brokerId,
    stageId: p.stageId,
    loanAmount: p.loanAmount ?? null,
    nurturedAt: p.nurturedAt ?? null,
    settledOn: p.settledOn ?? null,
  } as unknown as Deal;
}

const roster = [broker("mm", "Michael"), broker("nn", "Nick")];

describe("buildBrokerLeaderboard", () => {
  const deals = [
    deal({ brokerId: "mm", stageId: "settled", loanAmount: 600_000 }),
    deal({ brokerId: "mm", stageId: "settled", loanAmount: 400_000 }),
    deal({ brokerId: "mm", stageId: "pre-lodge", loanAmount: 500_000 }),
    deal({ brokerId: "mm", stageId: "pre-lodge", nurturedAt: "2026-01-01" }), // parked
    deal({ brokerId: "nn", stageId: "settled", loanAmount: 300_000 }),
    deal({ brokerId: "nn", stageId: "lodged", loanAmount: 350_000 }),
  ];
  const board = buildBrokerLeaderboard(deals, roster);

  it("ranks brokers by settled value and represents the whole roster", () => {
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0].name).toBe("Michael"); // $1.0M > $0.3M
    expect(board.rows[1].name).toBe("Nick");
  });

  it("counts settled/open and excludes parked deals from open", () => {
    const mm = board.rows.find((r) => r.name === "Michael")!;
    expect(mm.settled).toBe(2);
    expect(mm.open).toBe(1); // nurtured deal excluded
    expect(mm.total).toBe(3);
    expect(mm.settledValue).toBe(1_000_000);
    expect(mm.avgSettledLoan).toBe(500_000);
    expect(mm.settledRate).toBeCloseTo(2 / 3, 5);
    expect(mm.openPipelineValue).toBe(500_000);
  });

  it("includes a roster broker with no deals as an empty row", () => {
    const board2 = buildBrokerLeaderboard([], roster);
    expect(board2.rows).toHaveLength(2);
    expect(board2.rows.every((r) => r.total === 0 && r.settledRate === 0)).toBe(true);
  });

  it("totals across the team", () => {
    expect(board.totals.settled).toBe(3);
    expect(board.totals.settledValue).toBe(1_300_000);
    expect(board.totals.open).toBe(2);
  });
});

describe("buildBrokerTrend", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  it("buckets settled value by month per roster broker", () => {
    const trend = buildBrokerTrend(
      [
        deal({ brokerId: "mm", stageId: "settled", loanAmount: 500_000, settledOn: "2026-07-02" }),
        deal({ brokerId: "mm", stageId: "settled", loanAmount: 300_000, settledOn: "2026-06-10" }),
        deal({ brokerId: "xx", stageId: "settled", loanAmount: 900_000, settledOn: "2026-07-01" }), // not on roster
      ],
      roster,
      now,
      6,
    );
    expect(trend.months).toHaveLength(6);
    expect(trend.series).toHaveLength(1); // only Michael; xx excluded
    const mm = trend.series[0];
    expect(mm.name).toBe("Michael");
    expect(mm.total).toBe(800_000);
    expect(mm.monthly[trend.months.length - 1]).toBe(500_000); // Jul
    expect(trend.max).toBe(500_000);
  });
});

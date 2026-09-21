import { describe, it, expect } from "vitest";
import { buildControlTower } from "./control-tower";
import type { Deal, StageId } from "./clients/salestrekker/types";
import type { LenderSlaValues } from "./lenders";

const NOW = new Date("2026-07-15T12:00:00Z");

function deal(p: {
  id: string;
  stageId: StageId;
  daysSinceContact?: number;
  loanAmount?: number | null;
  nurturedAt?: string | null;
  preApprovalExpiry?: string | null;
}): Deal {
  return {
    id: p.id,
    name: `Client ${p.id}`,
    brokerId: "mm",
    stageId: p.stageId,
    daysSinceContact: p.daysSinceContact ?? 0,
    loanAmount: p.loanAmount ?? null,
    nurturedAt: p.nurturedAt ?? null,
    preApprovalExpiry: p.preApprovalExpiry ?? null,
    settlement: "TBD",
    overdue: [],
    pending: [],
    received: [],
    advisory: [],
  } as unknown as Deal;
}

describe("buildControlTower", () => {
  const deals = [
    deal({ id: "settling", stageId: "settle-booked", loanAmount: 500_000 }),
    deal({ id: "stale", stageId: "lodged", daysSinceContact: 5, loanAmount: 400_000 }),
    deal({ id: "cond", stageId: "cond-approved" }),
    deal({ id: "pa", stageId: "pre-approval", preApprovalExpiry: "2026-07-25" }), // 10 days
    deal({ id: "gone", stageId: "settled" }),
    deal({ id: "parked", stageId: "unconditional", nurturedAt: "2026-01-01" }),
  ];
  const emptySla = new Map<string, LenderSlaValues>();
  const tower = buildControlTower(deals, emptySla, new Set(), NOW);

  it("counts the active pipeline and what's settling soon", () => {
    expect(tower.stats.openDeals).toBe(4); // settling, stale, cond, pa
    expect(tower.stats.settlingSoon).toBe(1); // settle-booked
    expect(tower.stats.settlingValue).toBe(500_000);
  });

  it("counts stale deals and expiring pre-approvals", () => {
    expect(tower.stats.staleDeals).toBe(1); // 5 days since contact
    expect(tower.stats.preApprovalExpiring).toBe(1);
  });

  it("counts pending milestone comms (settle-booked + cond-approved)", () => {
    expect(tower.stats.pendingComms).toBe(2);
  });

  it("raises alerts and ranks critical before warning before info", () => {
    const ids = tower.alerts.map((a) => a.id);
    expect(ids).toContain("stale");
    expect(ids).toContain("preapproval");
    expect(ids).toContain("milestone-comms");
    // The milestone-comms alert is info, so it must not precede any warning.
    const severities = tower.alerts.map((a) => a.severity);
    const firstInfo = severities.indexOf("info");
    const lastWarning = severities.lastIndexOf("warning");
    if (firstInfo !== -1 && lastWarning !== -1) {
      expect(firstInfo).toBeGreaterThan(lastWarning);
    }
  });
});

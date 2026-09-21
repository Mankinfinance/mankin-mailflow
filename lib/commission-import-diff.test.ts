import { describe, it, expect } from "vitest";
import { diffCommissionImport } from "./commission-import-diff";
import type { SettlementRow } from "./commission-parser";

function row(id: string, over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id,
    loanId: id,
    brokerName: "",
    brokerId: null,
    clientName: "",
    lender: "",
    lenderCode: "",
    settlementDate: "2025-01-01",
    settlementAmount: 0,
    currentBalance: 0,
    upfrontCommission: 0,
    monthlyTrail: 0,
    loanStatus: "active",
    dischargeDate: null,
    source: { onUpfront: true, onTrail: false, onClawback: false },
    ...over,
  } as SettlementRow;
}

describe("diffCommissionImport", () => {
  it("classifies new / carried / dropped and preserves review counts", () => {
    // Existing back-book: L1, L2, L3. Reviews on L1 and L3.
    // Incoming file: L1 (carried, reviewed), L2 (carried), L4 (new).
    // => L3 dropped off and it had a review (orphaned).
    const d = diffCommissionImport({
      incoming: [row("L1"), row("L2"), row("L4")],
      existingIds: ["L1", "L2", "L3"],
      reviewedIds: ["L1", "L3"],
    });
    expect(d.incoming).toBe(3);
    expect(d.newLoans).toBe(1); // L4
    expect(d.carriedOver).toBe(2); // L1, L2
    expect(d.droppedOff).toBe(1); // L3
    expect(d.reviewsPreserved).toBe(1); // L1
    expect(d.reviewsOrphaned).toBe(1); // L3
  });

  it("counts discharged/closed loans on the file", () => {
    const d = diffCommissionImport({
      incoming: [
        row("L1", { loanStatus: "discharged" }),
        row("L2", { loanStatus: "closed" }),
        row("L3", { loanStatus: "active" }),
      ],
      existingIds: [],
      reviewedIds: [],
    });
    expect(d.dischargedOnFile).toBe(2);
    expect(d.newLoans).toBe(3);
  });

  it("first-ever import: everything new, nothing dropped or orphaned", () => {
    const d = diffCommissionImport({
      incoming: [row("L1"), row("L2")],
      existingIds: [],
      reviewedIds: [],
    });
    expect(d.newLoans).toBe(2);
    expect(d.carriedOver).toBe(0);
    expect(d.droppedOff).toBe(0);
    expect(d.reviewsOrphaned).toBe(0);
  });

  it("identical re-upload: all carried, none new or dropped", () => {
    const d = diffCommissionImport({
      incoming: [row("L1"), row("L2")],
      existingIds: ["L1", "L2"],
      reviewedIds: ["L1"],
    });
    expect(d.newLoans).toBe(0);
    expect(d.carriedOver).toBe(2);
    expect(d.droppedOff).toBe(0);
    expect(d.reviewsPreserved).toBe(1);
  });
});

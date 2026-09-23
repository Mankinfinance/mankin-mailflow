import { describe, it, expect } from "vitest";
import { endingEvent, enteredPayload, endedPayload } from "./lifecycle";
import type { AutomationRow, AutomationRunRow } from "@/lib/db/schema";

const automation = { id: "a-1", name: "Pre-approval going cold" } as AutomationRow;

function run(over: Partial<AutomationRunRow> = {}): AutomationRunRow {
  return {
    id: "r-1",
    automationId: "a-1",
    email: "tom@example.com",
    name: "Tom Reilly",
    sourceKind: "deals",
    sourceId: "D-12",
    enteredAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  } as AutomationRunRow;
}

describe("endingEvent", () => {
  it("calls any designed end a completion", () => {
    expect(endingEvent({ kind: "finished", nodeId: "exit-x", note: null })).toBe(
      "automation.completed",
    );
    expect(endingEvent({ kind: "finished", nodeId: null, note: null })).toBe(
      "automation.completed",
    );
  });

  it("calls being stopped from outside an exit", () => {
    expect(endingEvent({ kind: "unsubscribed" })).toBe("automation.exited");
    expect(endingEvent({ kind: "broken", error: "x" })).toBe("automation.exited");
  });
});

describe("enteredPayload", () => {
  it("carries the deal for a pipeline contact", () => {
    const payload = enteredPayload({
      automation,
      run: run(),
      trigger: { kind: "pipeline-stage", stageId: "pre-approval", afterDays: 60 },
      triggerDescription: "A deal has been at Pre-Approval for 60 days",
    });
    expect(payload).toMatchObject({
      automationId: "a-1",
      runId: "r-1",
      dealId: "D-12",
      trigger: { kind: "pipeline-stage", afterDays: 60 },
    });
  });

  it("has no deal for the back-book", () => {
    const payload = enteredPayload({
      automation,
      run: run({ sourceKind: "settlements", sourceId: "L-1" }),
      trigger: { kind: "settlement-anniversary", months: 12 },
      triggerDescription: "",
    });
    expect(payload.dealId).toBeNull();
  });
});

describe("endedPayload", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  it("says which end, in the author's words, for a completion", () => {
    const payload = endedPayload({
      automation,
      run: run(),
      now,
      ending: { kind: "finished", nodeId: "exit-nudged", note: "Nudged once." },
    });
    expect(payload).toMatchObject({
      endNodeId: "exit-nudged",
      outcome: "Nudged once.",
      daysInSequence: 10,
    });
    expect(payload).not.toHaveProperty("reason");
  });

  it("gives the reason, and the error when broken, for an exit", () => {
    const payload = endedPayload({
      automation,
      run: run(),
      now,
      ending: { kind: "broken", error: "Step send-2 points at nothing." },
    });
    expect(payload).toMatchObject({
      reason: "broken",
      error: "Step send-2 points at nothing.",
    });
    expect(payload).not.toHaveProperty("outcome");
  });
});

import { describe, it, expect } from "vitest";
import {
  addDays,
  nextAction,
  reachableNodes,
  validateFlow,
  type RunPosition,
} from "./engine";
import { AUTOMATION_TEMPLATES, type AutomationFlow } from "./types";

const ANNUAL = AUTOMATION_TEMPLATES[0].flow;
const NOW = new Date("2026-08-25T09:00:00Z");

function position(over: Partial<RunPosition> = {}): RunPosition {
  return {
    nodeId: ANNUAL.entryNodeId,
    enteredNodeAt: NOW,
    lastSend: null,
    ...over,
  };
}

describe("nextAction", () => {
  it("starts by sending the first email", () => {
    const action = nextAction(ANNUAL, position(), NOW);
    expect(action.type).toBe("send");
    if (action.type !== "send") return;
    expect(action.subject).toContain("{{first_name}}");
    expect(action.thenNodeId).toBe("wait-5");
  });

  it("holds at a delay for the stated number of days", () => {
    const action = nextAction(ANNUAL, position({ nodeId: "wait-5" }), NOW);
    expect(action.type).toBe("wait");
    if (action.type !== "wait") return;
    expect(action.until).toEqual(addDays(NOW, 5));
  });

  it("keeps holding partway through the wait", () => {
    // Arrived three days ago on a five-day delay: two days left.
    const action = nextAction(
      ANNUAL,
      position({ nodeId: "wait-5", enteredNodeAt: addDays(NOW, -3) }),
      NOW,
    );
    expect(action).toEqual({
      type: "wait",
      nodeId: "wait-5",
      until: addDays(addDays(NOW, -3), 5),
    });
  });

  it("moves on once the wait has expired", () => {
    const action = nextAction(
      ANNUAL,
      position({ nodeId: "wait-5", enteredNodeAt: addDays(NOW, -6) }),
      NOW,
    );
    expect(action).toEqual({ type: "move", nodeId: "opened?", because: "yes" });
  });

  it("measures the delay from arrival, not from when it was last looked at", () => {
    // The bug this guards: measuring from the runner's "look again"
    // stamp made every delay expire the instant it was reached, so a
    // five-day sequence ran end to end in one pass.
    const justArrived = nextAction(
      ANNUAL,
      position({ nodeId: "wait-5", enteredNodeAt: NOW }),
      NOW,
    );
    expect(justArrived.type).toBe("wait");
  });

  it("takes the YES branch as soon as the email is opened", () => {
    const action = nextAction(
      ANNUAL,
      position({
        nodeId: "opened?",
        lastSend: {
          at: addDays(NOW, -1),
          openedAt: addDays(NOW, -1),
          clickedAt: null,
        },
      }),
      NOW,
    );
    // No need to wait out the window — the answer cannot change.
    expect(action).toEqual({ type: "move", nodeId: "exit-opened", because: "yes" });
  });

  it("waits out the window before deciding an email went unopened", () => {
    // The difference between a sequence that feels attentive and one
    // that follows up before the customer has opened their inbox.
    const action = nextAction(
      ANNUAL,
      position({
        nodeId: "opened?",
        lastSend: { at: addDays(NOW, -2), openedAt: null, clickedAt: null },
      }),
      NOW,
    );
    expect(action.type).toBe("wait");
  });

  it("takes the NO branch once the window has closed", () => {
    const action = nextAction(
      ANNUAL,
      position({
        nodeId: "opened?",
        lastSend: { at: addDays(NOW, -6), openedAt: null, clickedAt: null },
      }),
      NOW,
    );
    expect(action).toEqual({
      type: "move",
      nodeId: "send-followup",
      because: "no",
    });
  });

  it("does not stall forever when there is no send to judge", () => {
    const action = nextAction(ANNUAL, position({ nodeId: "opened?" }), NOW);
    expect(action).toEqual({
      type: "move",
      nodeId: "send-followup",
      because: "no",
    });
  });

  it("ends at an exit, carrying its note", () => {
    const action = nextAction(ANNUAL, position({ nodeId: "exit-opened" }), NOW);
    expect(action.type).toBe("exit");
    if (action.type !== "exit") return;
    expect(action.note).toContain("Opened");
  });

  it("reports a broken pointer rather than silently ending the run", () => {
    const broken: AutomationFlow = {
      ...ANNUAL,
      nodes: ANNUAL.nodes.map((n) =>
        n.id === "wait-5" ? { ...n, next: "nowhere" } : n,
      ),
    };
    const action = nextAction(
      broken,
      position({ nodeId: "wait-5", enteredNodeAt: addDays(NOW, -6) }),
      NOW,
    );
    expect(action.type).toBe("broken");
  });

  it("checks clicks when the condition asks for clicks", () => {
    const clickFlow: AutomationFlow = {
      ...ANNUAL,
      nodes: ANNUAL.nodes.map((n) =>
        n.id === "opened?" ? { ...n, check: "clicked" as const } : n,
      ),
    };
    // Opened but not clicked, window closed → NO.
    const action = nextAction(
      clickFlow,
      position({
        nodeId: "opened?",
        lastSend: { at: addDays(NOW, -6), openedAt: addDays(NOW, -5), clickedAt: null },
      }),
      NOW,
    );
    expect(action).toMatchObject({ because: "no" });
  });
});

describe("reachableNodes", () => {
  it("walks both branches of a condition", () => {
    const ids = reachableNodes(ANNUAL).map((n) => n.id);
    expect(ids).toContain("send-review");
    expect(ids).toContain("send-followup");
    expect(ids).toContain("exit-opened");
    expect(ids).toContain("exit-unopened");
  });

  it("never loops forever on a flow that points back at itself", () => {
    const looped: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "a",
      nodes: [
        { id: "a", kind: "delay", days: 1, next: "b" },
        { id: "b", kind: "delay", days: 1, next: "a" },
      ],
    };
    expect(reachableNodes(looped).map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("validateFlow", () => {
  it("passes a template", () => {
    for (const template of AUTOMATION_TEMPLATES) {
      expect(validateFlow(template.flow)).toEqual([]);
    }
  });

  it("catches a send with nothing written in it", () => {
    const flow: AutomationFlow = {
      ...ANNUAL,
      nodes: ANNUAL.nodes.map((n) =>
        n.id === "send-review" ? { ...n, subject: "", body: "" } : n,
      ),
    };
    expect(validateFlow(flow).join(" ")).toMatch(/no subject or body/);
  });

  it("catches a step nothing points at", () => {
    const flow: AutomationFlow = {
      ...ANNUAL,
      nodes: [
        ...ANNUAL.nodes,
        { id: "orphan", kind: "exit" as const, note: "stranded" },
      ],
    };
    expect(validateFlow(flow).join(" ")).toMatch(/not connected/);
  });

  it("catches a sequence that never sends anything", () => {
    const flow: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "x",
      nodes: [{ id: "x", kind: "exit" }],
    };
    expect(validateFlow(flow).join(" ")).toMatch(/never sends/);
  });
});

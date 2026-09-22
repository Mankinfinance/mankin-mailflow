import { describe, it, expect } from "vitest";
import {
  addDays,
  dataConditionAnswer,
  describeCondition,
  nextAction,
  reachableNodes,
  splitSide,
  validateFlow,
  type ContactFacts,
  type RunPosition,
} from "./engine";
import {
  AUTOMATION_TEMPLATES,
  type AutomationFlow,
  type DataCondition,
} from "./types";

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
  it("passes a template, bar the choices a template cannot make", () => {
    /* Some templates ship with a blank on purpose, because the answer
       belongs to the broker: which form or tag starts it, and which
       survey a survey step asks. A placeholder would go live and
       quietly never fire, or invite a client to answer a survey that
       does not exist. Everything else about them must still be sound,
       so the assertion is that every outstanding problem is one of
       those choices — not that such templates skip validation. */
    const CHOICE =
      /^(Choose which (form|tag) starts|".+" has no survey chosen yet\.$)/;

    for (const template of AUTOMATION_TEMPLATES) {
      const problems = validateFlow(template.flow);
      const blanks =
        (template.flow.trigger.kind === "form-submission" ||
        template.flow.trigger.kind === "tag-added"
          ? 1
          : 0) +
        template.flow.nodes.filter(
          (n) => n.kind === "survey" && !n.surveyId?.trim(),
        ).length;

      if (blanks === 0) {
        expect(problems, template.id).toEqual([]);
        continue;
      }
      /* validateFlow deduplicates, so two identically-labelled blanks
         collapse into one message — the count is a ceiling. */
      expect(problems.length, template.id).toBeGreaterThan(0);
      expect(problems.length, template.id).toBeLessThanOrEqual(blanks);
      for (const problem of problems) {
        expect(problem, template.id).toMatch(CHOICE);
      }
    }
  });

  it("clears once the broker names the survey", () => {
    const withSurvey = AUTOMATION_TEMPLATES.find((t) =>
      t.flow.nodes.some((n) => n.kind === "survey"),
    )!;
    const chosen: AutomationFlow = {
      ...withSurvey.flow,
      nodes: withSurvey.flow.nodes.map((n) =>
        n.kind === "survey" ? { ...n, surveyId: "S-1" } : n,
      ),
    };
    expect(validateFlow(chosen)).toEqual([]);
  });

  it("clears once the broker names the form", () => {
    const welcome = AUTOMATION_TEMPLATES.find(
      (t) => t.flow.trigger.kind === "form-submission",
    )!;
    const chosen: AutomationFlow = {
      ...welcome.flow,
      trigger: { kind: "form-submission", formId: "F-1" },
    };
    expect(validateFlow(chosen)).toEqual([]);
  });

  it("clears once the broker names the tag", () => {
    const tagged = AUTOMATION_TEMPLATES.find(
      (t) => t.flow.trigger.kind === "tag-added",
    )!;
    const chosen: AutomationFlow = {
      ...tagged.flow,
      trigger: { kind: "tag-added", tag: "Refinance watch" },
    };
    expect(validateFlow(chosen)).toEqual([]);
  });

  it("does not accept whitespace as a choice", () => {
    const flow: AutomationFlow = {
      trigger: { kind: "tag-added", tag: "   " },
      entryNodeId: "out",
      nodes: [{ id: "out", kind: "exit" }],
    };
    expect(validateFlow(flow).some((p) => /Choose which tag/.test(p))).toBe(true);
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

/* -------------------------------------------------------------------------- */
/* Conditions that ask about the contact rather than the last send            */
/* -------------------------------------------------------------------------- */

const FACTS: ContactFacts = {
  tags: ["refinance watch", "vip"],
  lenderCode: "ANZ",
  currentBalance: 480_000,
  settlementDate: "2024-08-25",
  brokerId: "mm",
};

/** A two-branch flow whose single question is the one under test. */
function branchOn(condition: DataCondition): AutomationFlow {
  return {
    trigger: { kind: "settlement-anniversary", months: 12 },
    entryNodeId: "ask",
    nodes: [
      { id: "ask", kind: "condition", condition, nextYes: "yes", nextNo: "no" },
      { id: "yes", kind: "exit", note: "took yes" },
      { id: "no", kind: "exit", note: "took no" },
    ],
  };
}

function askedWith(
  condition: DataCondition,
  contact: ContactFacts | null,
): ReturnType<typeof nextAction> {
  return nextAction(
    branchOn(condition),
    { nodeId: "ask", enteredNodeAt: NOW, lastSend: null, contact },
    NOW,
  );
}

describe("dataConditionAnswer", () => {
  it("matches a tag case-insensitively, as tags are everywhere else", () => {
    expect(dataConditionAnswer({ kind: "tag", tag: "Refinance Watch" }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "tag", tag: "  vip  " }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "tag", tag: "dormant" }, FACTS, NOW)).toBe(false);
  });

  it("matches any of several lenders", () => {
    expect(dataConditionAnswer({ kind: "lender", codes: ["cba", "ANZ"] }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "lender", codes: ["CBA"] }, FACTS, NOW)).toBe(false);
  });

  it("treats both balance bounds as inclusive", () => {
    expect(dataConditionAnswer({ kind: "balance", min: 480_000 }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "balance", max: 480_000 }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "balance", min: 480_001 }, FACTS, NOW)).toBe(false);
    expect(dataConditionAnswer({ kind: "balance", max: 479_999 }, FACTS, NOW)).toBe(false);
  });

  it("accepts a one-sided balance band", () => {
    expect(dataConditionAnswer({ kind: "balance", min: 100_000 }, FACTS, NOW)).toBe(true);
    expect(
      dataConditionAnswer({ kind: "balance", min: 100_000, max: 900_000 }, FACTS, NOW),
    ).toBe(true);
  });

  it("counts loan age in whole months", () => {
    // Settled 2024-08-25, asked on 2026-08-25: two years to the day.
    // Pinned to NOW rather than the real clock, or this passes today
    // and fails in a month.
    expect(dataConditionAnswer({ kind: "loan-age", minMonths: 24 }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "loan-age", minMonths: 25 }, FACTS, NOW)).toBe(false);
    expect(dataConditionAnswer({ kind: "loan-age", maxMonths: 24 }, FACTS, NOW)).toBe(true);
  });

  it("matches the owning broker", () => {
    expect(dataConditionAnswer({ kind: "broker", brokerIds: ["mm", "na"] }, FACTS, NOW)).toBe(true);
    expect(dataConditionAnswer({ kind: "broker", brokerIds: ["na"] }, FACTS, NOW)).toBe(false);
  });

  it("is unknowable when the contact's record is gone", () => {
    expect(dataConditionAnswer({ kind: "lender", codes: ["ANZ"] }, null, NOW)).toBe("unknowable");
  });

  it("separates 'no lender recorded' from 'a different lender'", () => {
    // False would send them down the "not with ANZ" branch, which is a
    // claim about a fact we do not have.
    const noLender = { ...FACTS, lenderCode: null };
    expect(dataConditionAnswer({ kind: "lender", codes: ["ANZ"] }, noLender, NOW)).toBe(
      "unknowable",
    );
    const noBalance = { ...FACTS, currentBalance: null };
    expect(dataConditionAnswer({ kind: "balance", min: 1 }, noBalance, NOW)).toBe("unknowable");
    const noSettlement = { ...FACTS, settlementDate: null };
    expect(dataConditionAnswer({ kind: "loan-age", minMonths: 1 }, noSettlement, NOW)).toBe(
      "unknowable",
    );
  });

  it("answers a tag question for a contact with no loan at all", () => {
    // A tag lives on the address, so it is answerable even when
    // nothing else about them is.
    const bare: ContactFacts = {
      tags: ["vip"],
      lenderCode: null,
      currentBalance: null,
      settlementDate: null,
      brokerId: null,
    };
    expect(dataConditionAnswer({ kind: "tag", tag: "vip" }, bare, NOW)).toBe(true);
  });

  it("reads an unparseable settlement date as unknowable, not as age zero", () => {
    const bad = { ...FACTS, settlementDate: "not-a-date" };
    expect(dataConditionAnswer({ kind: "loan-age", minMonths: 1 }, bad, NOW)).toBe("unknowable");
  });
});

describe("the engine running a data condition", () => {
  it("takes the yes branch without waiting for a window", () => {
    // Unlike an open, the answer cannot change later, so there is
    // nothing to hold the contact here for.
    const action = askedWith({ kind: "tag", tag: "vip" }, FACTS);
    expect(action).toEqual({ type: "move", nodeId: "yes", because: "yes" });
  });

  it("takes the no branch", () => {
    const action = askedWith({ kind: "tag", tag: "dormant" }, FACTS);
    expect(action).toEqual({ type: "move", nodeId: "no", because: "no" });
  });

  it("does not need a send before it to answer", () => {
    // An engagement condition placed first has nothing to judge. A
    // question about the contact always does.
    const action = askedWith({ kind: "broker", brokerIds: ["mm"] }, FACTS);
    expect(action.type).toBe("move");
  });

  it("stops the sequence when the fact cannot be established", () => {
    // Guessing a branch would send the wrong email; holding them here
    // would hide it.
    const action = askedWith({ kind: "lender", codes: ["ANZ"] }, null);
    expect(action.type).toBe("exit");
    if (action.type !== "exit") return;
    expect(action.note).toMatch(/no longer in the book/);
  });

  it("exits rather than breaking when a branch points nowhere", () => {
    const flow = branchOn({ kind: "tag", tag: "vip" });
    flow.nodes[0].nextYes = null;
    const action = nextAction(
      flow,
      { nodeId: "ask", enteredNodeAt: NOW, lastSend: null, contact: FACTS },
      NOW,
    );
    expect(action.type).toBe("exit");
  });
});

describe("a branch with no question set", () => {
  it("is reported by validateFlow", () => {
    const flow: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "ask",
      nodes: [
        { id: "ask", kind: "condition", label: "Opened?", nextYes: "out", nextNo: "out" },
        { id: "out", kind: "exit" },
      ],
    };
    expect(validateFlow(flow).some((p) => /no question set/.test(p))).toBe(true);
  });

  it("is broken rather than silently treated as an open check", () => {
    const flow: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "ask",
      nodes: [
        { id: "ask", kind: "condition", nextYes: "out", nextNo: "out" },
        { id: "out", kind: "exit" },
      ],
    };
    const action = nextAction(flow, { nodeId: "ask", enteredNodeAt: NOW, lastSend: null }, NOW);
    expect(action.type).toBe("broken");
  });
});

describe("describeCondition", () => {
  it("phrases each one as a question, because both arms say YES and NO", () => {
    expect(describeCondition({ kind: "tag", tag: "VIP" })).toBe('Tagged "VIP"?');
    expect(describeCondition({ kind: "lender", codes: ["ANZ"] })).toBe("Still with ANZ?");
    expect(describeCondition({ kind: "balance", min: 600000 })).toBe(
      "Balance over $600,000?",
    );
  });

  it("lists several lenders readably", () => {
    expect(describeCondition({ kind: "lender", codes: ["ANZ", "CBA", "NAB"] })).toBe(
      "With ANZ, CBA or NAB?",
    );
  });

  it("names the broker rather than showing an id", () => {
    expect(
      describeCondition({ kind: "broker", brokerIds: ["mm"] }, { brokers: { mm: "Michael" } }),
    ).toBe("Michael's client?");
  });

  it("falls back to the id when no name is supplied", () => {
    expect(describeCondition({ kind: "broker", brokerIds: ["mm"] })).toBe("mm's client?");
  });

  it("reads a two-sided band as a range", () => {
    expect(describeCondition({ kind: "balance", min: 400000, max: 600000 })).toBe(
      "Balance between $400,000 and $600,000?",
    );
    expect(describeCondition({ kind: "loan-age", minMonths: 12, maxMonths: 24 })).toBe(
      "Settled 12–24 months ago?",
    );
  });

  it("says years where the months divide evenly", () => {
    // "over 24 months" is how a database thinks; "over 2 years" is how
    // a broker says it.
    expect(describeCondition({ kind: "loan-age", minMonths: 24 })).toBe(
      "Settled over 2 years ago?",
    );
    expect(describeCondition({ kind: "loan-age", minMonths: 12 })).toBe(
      "Settled over a year ago?",
    );
    expect(describeCondition({ kind: "loan-age", minMonths: 18 })).toBe(
      "Settled over 18 months ago?",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The 50/50 split, and the survey step                                       */
/* -------------------------------------------------------------------------- */

function splitFlow(percent?: number): AutomationFlow {
  return {
    trigger: { kind: "settlement-anniversary", months: 12 },
    entryNodeId: "split",
    nodes: [
      { id: "split", kind: "split", splitPercent: percent, nextYes: "a", nextNo: "b" },
      { id: "a", kind: "exit", note: "A" },
      { id: "b", kind: "exit", note: "B" },
    ],
  };
}

function sideFor(email: string, percent?: number): string {
  const action = nextAction(
    splitFlow(percent),
    { nodeId: "split", enteredNodeAt: NOW, lastSend: null, splitKey: email },
    NOW,
  );
  return action.type === "move" ? action.nodeId : action.type;
}

describe("splitSide", () => {
  it("gives the same answer every time it is asked", () => {
    // The whole reason this is a hash and not a random draw: the runner
    // may re-evaluate a node after a crash, and a re-roll could send
    // one person down both branches.
    const first = splitSide("sarah@example.com", "split-1", 50);
    for (let i = 0; i < 50; i++) {
      expect(splitSide("sarah@example.com", "split-1", 50)).toBe(first);
    }
  });

  it("sends the same contact different ways at two different splits", () => {
    // Otherwise a second-stage split would be a no-op for everyone who
    // took the same side of the first.
    const sides = new Set(
      ["split-1", "split-2", "split-3", "split-4"].map((id) =>
        splitSide("sarah@example.com", id, 50),
      ),
    );
    expect(sides.size).toBe(2);
  });

  it("splits a realistic list somewhere near the requested share", () => {
    const emails = Array.from({ length: 800 }, (_, i) => `person${i}@example.com`);
    const yes = emails.filter((e) => splitSide(e, "split-1", 50)).length;
    expect(yes / emails.length).toBeGreaterThan(0.42);
    expect(yes / emails.length).toBeLessThan(0.58);
  });

  it("honours an uneven share", () => {
    const emails = Array.from({ length: 800 }, (_, i) => `person${i}@example.com`);
    const yes = emails.filter((e) => splitSide(e, "split-1", 20)).length;
    expect(yes / emails.length).toBeGreaterThan(0.14);
    expect(yes / emails.length).toBeLessThan(0.27);
  });
});

describe("the engine running a split", () => {
  it("routes to one arm or the other, never pending", () => {
    expect(["a", "b"]).toContain(sideFor("sarah@example.com"));
  });

  it("defaults to an even split when no share is set", () => {
    const emails = Array.from({ length: 400 }, (_, i) => `p${i}@example.com`);
    const a = emails.filter((e) => sideFor(e) === "a").length;
    expect(a / emails.length).toBeGreaterThan(0.4);
    expect(a / emails.length).toBeLessThan(0.6);
  });

  it("exits rather than stalling when an arm points nowhere", () => {
    const flow = splitFlow();
    flow.nodes[0].nextYes = null;
    flow.nodes[0].nextNo = null;
    const action = nextAction(
      flow,
      { nodeId: "split", enteredNodeAt: NOW, lastSend: null, splitKey: "a@b.com" },
      NOW,
    );
    expect(action.type).toBe("exit");
  });

  it("is reported by validateFlow when it has only one path", () => {
    // A split with one arm is a delay wearing a test's clothes.
    const flow = splitFlow();
    flow.nodes[0].nextNo = null;
    expect(validateFlow(flow).some((p) => /only one path/.test(p))).toBe(true);
  });
});

describe("the survey step", () => {
  const surveyFlow = (over: Record<string, unknown> = {}): AutomationFlow => ({
    trigger: { kind: "settlement-anniversary", months: 12 },
    entryNodeId: "ask",
    nodes: [
      {
        id: "ask",
        kind: "survey",
        label: "Ask how it went",
        surveyId: "S-1",
        subject: "How did we do?",
        body: "Two questions: {{survey_link}}",
        next: "out",
        ...over,
      },
      { id: "out", kind: "exit" },
    ],
  });

  it("hands the node to the runner rather than resolving the link itself", () => {
    // Signing is async and server-only; the engine is neither.
    const action = nextAction(
      surveyFlow(),
      { nodeId: "ask", enteredNodeAt: NOW, lastSend: null },
      NOW,
    );
    expect(action.type).toBe("survey");
    if (action.type !== "survey") return;
    expect(action.surveyId).toBe("S-1");
    expect(action.body).toContain("{{survey_link}}");
    expect(action.thenNodeId).toBe("out");
  });

  it("is broken without a survey chosen", () => {
    const action = nextAction(
      surveyFlow({ surveyId: undefined }),
      { nodeId: "ask", enteredNodeAt: NOW, lastSend: null },
      NOW,
    );
    expect(action.type).toBe("broken");
  });

  it("is broken without a subject or body", () => {
    const action = nextAction(
      surveyFlow({ body: "" }),
      { nodeId: "ask", enteredNodeAt: NOW, lastSend: null },
      NOW,
    );
    expect(action.type).toBe("broken");
  });

  it("refuses to go live without the link in the body", () => {
    // Otherwise it is an email asking someone to answer a survey with
    // no way to answer it.
    const flow = surveyFlow({ body: "Two questions, please reply." });
    expect(validateFlow(flow).some((p) => /survey_link/.test(p))).toBe(true);
  });

  it("passes validation once the body carries the link", () => {
    expect(validateFlow(surveyFlow())).toEqual([]);
  });

  it("is reported when no survey is chosen", () => {
    const flow = surveyFlow({ surveyId: undefined });
    expect(validateFlow(flow).some((p) => /no survey chosen/.test(p))).toBe(true);
  });
});

describe("a split's arms are part of the sequence", () => {
  it("counts both arms as reachable", () => {
    // Following `next` instead of the two arms left every split's
    // branches looking orphaned.
    const flow: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "split",
      nodes: [
        { id: "split", kind: "split", nextYes: "a", nextNo: "b" },
        { id: "a", kind: "send", subject: "A", body: "a", next: null },
        { id: "b", kind: "send", subject: "B", body: "b", next: null },
      ],
    };
    expect(reachableNodes(flow).map((n) => n.id).sort()).toEqual(["a", "b", "split"]);
    expect(validateFlow(flow)).toEqual([]);
  });

  it("reports an arm pointing at a step that is gone", () => {
    const flow: AutomationFlow = {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "split",
      nodes: [
        { id: "split", kind: "split", nextYes: "a", nextNo: "vanished" },
        { id: "a", kind: "send", subject: "A", body: "a", next: null },
      ],
    };
    expect(validateFlow(flow).some((p) => /split points at/.test(p))).toBe(true);
  });
});

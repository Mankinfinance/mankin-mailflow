import type { AutomationFlow, AutomationNode } from "./types";

/**
 * The automation engine: given a flow, where a contact is up to, and the
 * time, decide the one next thing to do.
 *
 * Pure. It performs no sends and reads no database — the runner applies
 * whatever it returns. That separation is what lets the whole of a
 * sequence's behaviour be tested in milliseconds, including the parts
 * that would otherwise take five days of real time to observe.
 */

export interface RunPosition {
  /** Node the contact is sitting on. */
  nodeId: string;
  /** When the contact arrived at that node. Delays are measured from
   *  here. An earlier version measured from the run's "look again"
   *  timestamp, which the runner sets to now on every move — so every
   *  delay expired the instant it was reached and the whole sequence
   *  ran in one pass. */
  enteredNodeAt: Date;
  /** Outcome of the most recent send in this run, for conditions. */
  lastSend: {
    at: Date;
    openedAt: Date | null;
    clickedAt: Date | null;
  } | null;
}

export type Action =
  /** Hold here until `until`. */
  | { type: "wait"; nodeId: string; until: Date }
  /** Send this email, then move to `thenNodeId` (null ends the run). */
  | { type: "send"; nodeId: string; subject: string; body: string; thenNodeId: string | null }
  /** A condition resolved; continue at `nodeId`. */
  | { type: "move"; nodeId: string; because: "yes" | "no" }
  /** The sequence is over. */
  | { type: "exit"; nodeId: string; note: string | null }
  /** The flow is malformed — a pointer goes nowhere. Surfaced rather
   *  than silently ending, so a broken flow is visible. */
  | { type: "broken"; nodeId: string; reason: string };

function nodeById(flow: AutomationFlow, id: string): AutomationNode | undefined {
  return flow.nodes.find((n) => n.id === id);
}

/**
 * Decide the next action.
 *
 * Called both when a contact first enters a sequence and every time a
 * wait expires. It never advances more than one step: the runner applies
 * the action, writes the new position, and asks again. One step per call
 * keeps every transition durable, so a crash mid-sequence resumes rather
 * than replays.
 */
export function nextAction(
  flow: AutomationFlow,
  position: RunPosition,
  now: Date,
): Action {
  const node = nodeById(flow, position.nodeId);
  if (!node) {
    return {
      type: "broken",
      nodeId: position.nodeId,
      reason: `No node with id "${position.nodeId}"`,
    };
  }

  switch (node.kind) {
    case "exit":
      return { type: "exit", nodeId: node.id, note: node.note ?? null };

    case "delay": {
      const until = addDays(position.enteredNodeAt, node.days ?? 0);
      if (until > now) return { type: "wait", nodeId: node.id, until };
      // Served, or a zero-day delay — move on.
      return followNext(flow, node);
    }

    case "send": {
      if (!node.subject?.trim() || !node.body?.trim()) {
        return {
          type: "broken",
          nodeId: node.id,
          reason: "Send node has no subject or body",
        };
      }
      return {
        type: "send",
        nodeId: node.id,
        subject: node.subject,
        body: node.body,
        thenNodeId: node.next ?? null,
      };
    }

    case "condition": {
      const answered = conditionAnswer(node, position, now);
      if (answered === "pending") {
        // The window has not closed and the answer could still change.
        const until = addDays(position.lastSend!.at, node.withinDays ?? 0);
        return { type: "wait", nodeId: node.id, until };
      }
      const target = answered === "yes" ? node.nextYes : node.nextNo;
      if (!target) {
        return { type: "exit", nodeId: node.id, note: null };
      }
      return { type: "move", nodeId: target, because: answered };
    }
  }
}

/**
 * Answer a condition, or say it is too early to tell.
 *
 * "Not opened" is only true once the window has closed. Deciding it the
 * moment we look would send the follow-up to someone who simply had not
 * got to their inbox yet, which is the difference between a sequence
 * that feels attentive and one that feels like a machine.
 */
function conditionAnswer(
  node: AutomationNode,
  position: RunPosition,
  now: Date,
): "yes" | "no" | "pending" {
  const send = position.lastSend;
  // No send to judge — treat as answered "no" so the flow keeps moving
  // rather than stalling a contact forever on an unanswerable question.
  if (!send) return "no";

  const hit = node.check === "clicked" ? send.clickedAt : send.openedAt;
  if (hit) return "yes";

  const deadline = addDays(send.at, node.withinDays ?? 0);
  return now >= deadline ? "no" : "pending";
}

function followNext(flow: AutomationFlow, node: AutomationNode): Action {
  const nextId = node.next ?? null;
  if (!nextId) return { type: "exit", nodeId: node.id, note: null };
  if (!nodeById(flow, nextId)) {
    return {
      type: "broken",
      nodeId: node.id,
      reason: `"${node.id}" points at missing node "${nextId}"`,
    };
  }
  return { type: "move", nodeId: nextId, because: "yes" };
}

export function addDays(from: Date, days: number): Date {
  const out = new Date(from);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Every node reachable from the entry, in order. Used by the canvas to
 * lay a flow out, and to warn about nodes that nothing points at.
 */
export function reachableNodes(flow: AutomationFlow): AutomationNode[] {
  const seen = new Set<string>();
  const out: AutomationNode[] = [];

  const walk = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    const node = nodeById(flow, id);
    if (!node) return;
    seen.add(id);
    out.push(node);
    if (node.kind === "condition") {
      walk(node.nextNo);
      walk(node.nextYes);
    } else {
      walk(node.next);
    }
  };

  walk(flow.entryNodeId);
  return out;
}

/**
 * Problems that should stop a flow going live. Returned as sentences a
 * broker can act on, not error codes.
 */
export function validateFlow(flow: AutomationFlow): string[] {
  const problems: string[] = [];
  const ids = new Set(flow.nodes.map((n) => n.id));

  if (!ids.has(flow.entryNodeId)) {
    problems.push("The sequence has no starting step.");
  }

  for (const node of flow.nodes) {
    if (node.kind === "send" && (!node.subject?.trim() || !node.body?.trim())) {
      problems.push(`"${node.label ?? node.id}" has no subject or body yet.`);
    }
    if (node.kind === "condition") {
      if (node.nextYes && !ids.has(node.nextYes)) {
        problems.push(`A condition points at a step that no longer exists.`);
      }
      if (node.nextNo && !ids.has(node.nextNo)) {
        problems.push(`A condition points at a step that no longer exists.`);
      }
    } else if (node.next && !ids.has(node.next)) {
      problems.push(`"${node.label ?? node.id}" points at a step that no longer exists.`);
    }
  }

  const reachable = new Set(reachableNodes(flow).map((n) => n.id));
  const orphans = flow.nodes.filter((n) => !reachable.has(n.id));
  if (orphans.length > 0) {
    problems.push(
      `${orphans.length} step${orphans.length === 1 ? " is" : "s are"} not connected to the sequence.`,
    );
  }

  const sends = flow.nodes.filter((n) => n.kind === "send").length;
  if (sends === 0) {
    problems.push("The sequence never sends anything.");
  }

  return [...new Set(problems)];
}

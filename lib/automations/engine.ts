import type { AutomationFlow, AutomationNode, DataCondition } from "./types";

/**
 * The automation engine: given a flow, where a contact is up to, and the
 * time, decide the one next thing to do.
 *
 * Pure. It performs no sends and reads no database — the runner applies
 * whatever it returns. That separation is what lets the whole of a
 * sequence's behaviour be tested in milliseconds, including the parts
 * that would otherwise take five days of real time to observe.
 */

/**
 * The contact's current record, for conditions that ask about them
 * rather than about the last email.
 *
 * Supplied by the runner on every step from the live book, not from the
 * values frozen at entry — see DataConditionSchema for why.
 */
export interface ContactFacts {
  /** Lower-cased tags currently on the contact. */
  tags: string[];
  lenderCode: string | null;
  currentBalance: number | null;
  /** ISO yyyy-mm-dd, or null for a pipeline contact with no settlement. */
  settlementDate: string | null;
  brokerId: string | null;
}

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
  /**
   * The contact as the book has them now. Null when they can no longer
   * be found in it — discharged, or the enquiry never became a deal.
   */
  contact?: ContactFacts | null;
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
      if (node.condition) {
        const answered = dataConditionAnswer(node.condition, position.contact, now);
        if (answered === "unknowable") {
          /* We cannot establish the fact this branch turns on. Sending
             down either path would be a guess, and holding the contact
             here forever hides it — so the sequence stops, with the
             reason on the canvas. A discharged loan is the usual
             cause, and a sequence about that loan should end. */
          return {
            type: "exit",
            nodeId: node.id,
            note: "Stopped: this contact is no longer in the book, so the branch could not be answered.",
          };
        }
        const branch = answered ? node.nextYes : node.nextNo;
        if (!branch) return { type: "exit", nodeId: node.id, note: null };
        return { type: "move", nodeId: branch, because: answered ? "yes" : "no" };
      }

      if (!node.check) {
        return {
          type: "broken",
          nodeId: node.id,
          reason: "Branch has no question set",
        };
      }

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

/**
 * Answer a question about the contact.
 *
 * Never "pending": unlike an open, every one of these is knowable the
 * moment we look. "unknowable" means the contact's record is gone, not
 * that the answer might arrive later.
 *
 * `now` is passed in rather than read from the clock so the one
 * condition that depends on the date — loan age — stays as testable as
 * the rest of the engine, and a run replayed at a different hour makes
 * the same decision.
 */
export function dataConditionAnswer(
  condition: DataCondition,
  contact: ContactFacts | null | undefined,
  now: Date,
): boolean | "unknowable" {
  if (!contact) return "unknowable";

  switch (condition.kind) {
    case "tag":
      return contact.tags.some(
        (t) => t.toLowerCase() === condition.tag.trim().toLowerCase(),
      );

    case "lender": {
      if (!contact.lenderCode) return "unknowable";
      const code = contact.lenderCode.toUpperCase();
      return condition.codes.some((c) => c.trim().toUpperCase() === code);
    }

    case "broker":
      if (!contact.brokerId) return "unknowable";
      return condition.brokerIds.includes(contact.brokerId);

    case "balance": {
      const balance = contact.currentBalance;
      if (balance === null) return "unknowable";
      if (condition.min !== undefined && balance < condition.min) return false;
      if (condition.max !== undefined && balance > condition.max) return false;
      return true;
    }

    case "loan-age": {
      if (!contact.settlementDate) return "unknowable";
      const months = monthsSince(contact.settlementDate, now);
      if (months === null) return "unknowable";
      if (condition.minMonths !== undefined && months < condition.minMonths) {
        return false;
      }
      if (condition.maxMonths !== undefined && months > condition.maxMonths) {
        return false;
      }
      return true;
    }
  }
}

/**
 * A data condition as a question, for the canvas card.
 *
 * Phrased as a question with a "?" because that is what a branch is,
 * and both arms are labelled YES and NO beneath it — "Still with ANZ?"
 * reads correctly above those two; "Lender is ANZ" does not.
 */
export function describeCondition(
  condition: DataCondition,
  names?: { brokers?: Record<string, string> },
): string {
  switch (condition.kind) {
    case "tag":
      return `Tagged "${condition.tag}"?`;

    case "lender":
      return condition.codes.length === 1
        ? `Still with ${condition.codes[0]}?`
        : `With ${listOf(condition.codes)}?`;

    case "broker": {
      const named = condition.brokerIds.map(
        (id) => names?.brokers?.[id] ?? id,
      );
      return named.length === 1
        ? `${named[0]}'s client?`
        : `A client of ${listOf(named)}?`;
    }

    case "balance": {
      const { min, max } = condition;
      if (min !== undefined && max !== undefined) {
        return `Balance between ${money(min)} and ${money(max)}?`;
      }
      if (min !== undefined) return `Balance over ${money(min)}?`;
      if (max !== undefined) return `Balance under ${money(max)}?`;
      return "Balance recorded?";
    }

    case "loan-age": {
      const { minMonths, maxMonths } = condition;
      if (minMonths !== undefined && maxMonths !== undefined) {
        return `Settled ${minMonths}–${maxMonths} months ago?`;
      }
      if (minMonths !== undefined) {
        return `Settled over ${describeMonths(minMonths)} ago?`;
      }
      if (maxMonths !== undefined) {
        return `Settled within ${describeMonths(maxMonths)}?`;
      }
      return "Has a settlement date?";
    }
  }
}

/** Years where they divide evenly — "over 2 years" beats "over 24 months". */
function describeMonths(months: number): string {
  if (months >= 12 && months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "a year" : `${years} years`;
  }
  return months === 1 ? "a month" : `${months} months`;
}

function money(v: number): string {
  return `$${Math.round(v).toLocaleString("en-AU")}`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Whole months between a settlement and `today`. */
function monthsSince(isoDate: string, today: Date): number | null {
  const from = new Date(isoDate);
  if (Number.isNaN(from.getTime())) return null;
  let months =
    (today.getFullYear() - from.getFullYear()) * 12 +
    (today.getMonth() - from.getMonth());
  /* Not a full month until the day of the month comes round. */
  if (today.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
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

  /* Two templates ship with the trigger deliberately blank, because
     which form or tag starts them is the broker's decision. Caught
     here rather than left to fail quietly: an unset form id matches no
     enquiry, so the sequence would sit live and never fire, and an
     empty tag would match a tag nobody applies. Both look like a
     working automation from the outside. */
  if (flow.trigger.kind === "form-submission" && !flow.trigger.formId.trim()) {
    problems.push("Choose which form starts this sequence.");
  }
  if (flow.trigger.kind === "tag-added" && !flow.trigger.tag.trim()) {
    problems.push("Choose which tag starts this sequence.");
  }

  for (const node of flow.nodes) {
    if (node.kind === "send" && (!node.subject?.trim() || !node.body?.trim())) {
      problems.push(`"${node.label ?? node.id}" has no subject or body yet.`);
    }
    if (node.kind === "condition") {
      /* Neither kind of question set. Worth its own message: the
         engine would otherwise fall through to reading `check`, which
         is undefined, and quietly behave as an "opened" check — a
         branch nobody asked for. */
      if (!node.condition && !node.check) {
        problems.push(
          `"${node.label ?? node.id}" is a branch with no question set.`,
        );
      }
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

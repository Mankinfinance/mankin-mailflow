import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { unknownMergeFields } from "@/lib/campaigns/merge";
import type { AutomationFlow, AutomationNode } from "./types";

/**
 * Editing one step of a sequence: its words and its timing, never its
 * shape. Adding, removing or rewiring steps would strand whoever is
 * partway through; changing what a step says or how long it waits does
 * not, so those are what a broker can change, live or not.
 *
 * Pure, so every rule is tested without a database.
 */

export interface StepPatch {
  label?: string;
  subject?: string;
  body?: string;
  days?: number;
  withinDays?: number;
  splitPercent?: number;
  note?: string;
}

export type EditResult = { ok: true; flow: AutomationFlow } | { ok: false; error: string };

/** Which fields each kind of step lets you change. */
export function editableFields(node: AutomationNode): Array<keyof StepPatch> {
  switch (node.kind) {
    case "send":
      return ["label", "subject", "body"];
    case "survey":
      return ["label", "subject", "body"];
    case "delay":
      return ["days"];
    case "condition":
      // A data condition is answered from the record, so it has no wait.
      return node.condition ? [] : ["withinDays"];
    case "split":
      return ["splitPercent"];
    case "exit":
      return ["note"];
  }
}

const SURVEY_FIELDS = [...MERGE_FIELDS, "survey_link"];

/* The default delay title, which would go stale if the days changed. */
const AUTO_WAIT_LABEL = /^wait \d+ days?$/i;

export function applyStepEdit(
  flow: AutomationFlow,
  nodeId: string,
  patch: StepPatch,
): EditResult {
  const index = flow.nodes.findIndex((n) => n.id === nodeId);
  if (index < 0) return { ok: false, error: "That step is no longer in the sequence." };
  const node = flow.nodes[index];
  const allowed = new Set(editableFields(node));
  const touched = (Object.keys(patch) as Array<keyof StepPatch>).filter(
    (k) => patch[k] !== undefined,
  );
  const refused = touched.find((k) => !allowed.has(k));
  if (refused) return { ok: false, error: "That can't be changed on this kind of step." };

  const next: AutomationNode = { ...node };

  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (label.length > 80) return { ok: false, error: "Keep the step name under 80 characters." };
    next.label = label || undefined;
  }

  if (patch.subject !== undefined || patch.body !== undefined) {
    const subject = (patch.subject ?? node.subject ?? "").trim();
    const body = (patch.body ?? node.body ?? "").trim();
    if (!subject) return { ok: false, error: "The email needs a subject line." };
    if (!body) return { ok: false, error: "The email needs a body." };
    const known = node.kind === "survey" ? SURVEY_FIELDS : [...MERGE_FIELDS];
    const unknown = [
      ...unknownMergeFields(subject, known),
      ...unknownMergeFields(body, known),
    ];
    if (unknown.length > 0) {
      return { ok: false, error: `Unknown merge field: {{${unknown[0]}}}.` };
    }
    if (node.kind === "survey" && !body.includes("{{survey_link}}")) {
      return {
        ok: false,
        error: "Keep {{survey_link}} in the body. It's the link to the survey.",
      };
    }
    next.subject = subject;
    next.body = body;
  }

  if (patch.days !== undefined) {
    if (!Number.isInteger(patch.days) || patch.days < 1 || patch.days > 365) {
      return { ok: false, error: "A wait is 1 to 365 days." };
    }
    next.days = patch.days;
    if (next.label && AUTO_WAIT_LABEL.test(next.label)) next.label = undefined;
  }

  if (patch.withinDays !== undefined) {
    if (!Number.isInteger(patch.withinDays) || patch.withinDays < 1 || patch.withinDays > 60) {
      return { ok: false, error: "Give it 1 to 60 days to answer." };
    }
    next.withinDays = patch.withinDays;
  }

  if (patch.splitPercent !== undefined) {
    if (!Number.isInteger(patch.splitPercent) || patch.splitPercent < 1 || patch.splitPercent > 99) {
      return { ok: false, error: "A split is 1% to 99% one way." };
    }
    next.splitPercent = patch.splitPercent;
  }

  if (patch.note !== undefined) {
    const note = patch.note.trim();
    if (note.length > 120) return { ok: false, error: "Keep the note under 120 characters." };
    next.note = note || undefined;
  }

  const nodes = [...flow.nodes];
  nodes[index] = next;
  return { ok: true, flow: { ...flow, nodes } };
}

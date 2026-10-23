import { describe, it, expect } from "vitest";
import { applyStepEdit, editableFields } from "./edit";
import { AUTOMATION_TEMPLATES, type AutomationFlow } from "./types";

const anniversary = AUTOMATION_TEMPLATES.find((t) =>
  t.flow.nodes.some((n) => n.kind === "delay") && t.flow.nodes.some((n) => n.kind === "condition"),
)!.flow as AutomationFlow;
const send = anniversary.nodes.find((n) => n.kind === "send")!;
const delay = anniversary.nodes.find((n) => n.kind === "delay")!;
const condition = anniversary.nodes.find((n) => n.kind === "condition" && !n.condition)!;
const surveyFlow = AUTOMATION_TEMPLATES.find((t) => t.flow.nodes.some((n) => n.kind === "survey"))!
  .flow as AutomationFlow;
const survey = surveyFlow.nodes.find((n) => n.kind === "survey")!;

const nodeIn = (r: ReturnType<typeof applyStepEdit>, id: string) =>
  r.ok ? r.flow.nodes.find((n) => n.id === id) : undefined;

describe("applyStepEdit", () => {
  it("rewrites a send's email and leaves the wiring alone", () => {
    const r = applyStepEdit(anniversary, send.id, {
      subject: "{{first_name}}, a year on",
      body: "Hi {{first_name}},\n\nA year already.",
    });
    expect(r.ok).toBe(true);
    const edited = nodeIn(r, send.id)!;
    expect(edited.subject).toBe("{{first_name}}, a year on");
    expect(edited.next).toBe(send.next);
    if (r.ok) expect(r.flow.nodes.length).toBe(anniversary.nodes.length);
  });

  it("does not change the flow it was given", () => {
    const before = JSON.stringify(anniversary);
    applyStepEdit(anniversary, send.id, { subject: "Changed" });
    expect(JSON.stringify(anniversary)).toBe(before);
  });

  it("refuses a misspelt merge field, an empty subject and an empty body", () => {
    expect(applyStepEdit(anniversary, send.id, { body: "Hi {{firstname}}" })).toEqual({
      ok: false,
      error: "Unknown merge field: {{firstname}}.",
    });
    expect(applyStepEdit(anniversary, send.id, { subject: "  " }).ok).toBe(false);
    expect(applyStepEdit(anniversary, send.id, { body: "" }).ok).toBe(false);
  });

  it("keeps the survey link in a survey invitation", () => {
    expect(applyStepEdit(surveyFlow, survey.id, { body: "How did we go?" }).ok).toBe(false);
    expect(
      applyStepEdit(surveyFlow, survey.id, { body: "How did we go? {{survey_link}}" }).ok,
    ).toBe(true);
  });

  it("changes a wait, within sensible bounds, and drops a stale 'Wait N days' title", () => {
    const labelled = {
      ...anniversary,
      nodes: anniversary.nodes.map((n) => (n.id === delay.id ? { ...n, label: "Wait 3 days" } : n)),
    };
    const r = applyStepEdit(labelled, delay.id, { days: 10 });
    expect(nodeIn(r, delay.id)?.days).toBe(10);
    expect(nodeIn(r, delay.id)?.label).toBeUndefined();
    expect(applyStepEdit(anniversary, delay.id, { days: 0 }).ok).toBe(false);
    expect(applyStepEdit(anniversary, delay.id, { days: 400 }).ok).toBe(false);
    expect(applyStepEdit(anniversary, delay.id, { days: 2.5 }).ok).toBe(false);
  });

  it("changes how long a condition waits for an answer", () => {
    expect(nodeIn(applyStepEdit(anniversary, condition.id, { withinDays: 7 }), condition.id)?.withinDays).toBe(7);
    expect(applyStepEdit(anniversary, condition.id, { withinDays: 0 }).ok).toBe(false);
  });

  it("only lets each kind of step change what belongs to it", () => {
    expect(applyStepEdit(anniversary, delay.id, { subject: "Hi" }).ok).toBe(false);
    expect(applyStepEdit(anniversary, send.id, { days: 3 }).ok).toBe(false);
    expect(editableFields({ id: "c", kind: "condition", condition: { kind: "tag", tag: "vip" } })).toEqual([]);
  });

  it("says so when the step is gone", () => {
    expect(applyStepEdit(anniversary, "nope", { days: 3 })).toEqual({
      ok: false,
      error: "That step is no longer in the sequence.",
    });
  });
});

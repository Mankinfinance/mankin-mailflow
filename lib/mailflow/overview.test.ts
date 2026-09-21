import { describe, it, expect } from "vitest";
import { buildAutomationOverview, buildFormOverview } from "./overview";
import type {
  AutomationRunRow,
  AutomationSendRow,
  FormRow,
  FormSubmissionRow,
} from "@/lib/db/schema";

const NOW = new Date("2026-08-25T09:00:00");
const SINCE = new Date("2026-07-26T09:00:00");
const OLD = new Date("2026-06-01T09:00:00");

function run(over: Partial<AutomationRunRow> = {}): AutomationRunRow {
  return { id: "r", status: "waiting", ...over } as AutomationRunRow;
}
function send(over: Partial<AutomationSendRow> = {}): AutomationSendRow {
  return {
    id: "s",
    sentAt: NOW,
    unsubscribedAt: null,
    ...over,
  } as AutomationSendRow;
}
function form(over: Partial<FormRow> = {}): FormRow {
  return { id: "f", status: "live", views: 100, ...over } as FormRow;
}
function submission(over: Partial<FormSubmissionRow> = {}): FormSubmissionRow {
  return {
    id: "sub",
    formId: "f",
    submittedAt: NOW,
    dealId: "deal-1",
    ...over,
  } as FormSubmissionRow;
}

describe("buildAutomationOverview", () => {
  it("separates who is still going from who has finished", () => {
    const overview = buildAutomationOverview({
      automations: [{ status: "live" }, { status: "paused" }],
      runs: [
        run({ id: "a", status: "waiting" }),
        run({ id: "b", status: "done" }),
        // Opted out partway — finished, not in progress.
        run({ id: "c", status: "exited" }),
      ],
      sends: [],
      since: SINCE,
    });
    expect(overview).toMatchObject({ live: 1, inProgress: 1, completed: 2 });
  });

  it("counts only sends inside the window", () => {
    const overview = buildAutomationOverview({
      automations: [],
      runs: [],
      sends: [send(), send({ id: "old", sentAt: OLD })],
      since: SINCE,
    });
    expect(overview.sentInWindow).toBe(1);
  });

  it("ignores a send that never went out", () => {
    const overview = buildAutomationOverview({
      automations: [],
      runs: [],
      sends: [send({ sentAt: null })],
      since: SINCE,
    });
    expect(overview.sentInWindow).toBe(0);
  });
});

describe("buildFormOverview", () => {
  it("weights conversion by views rather than averaging rates", () => {
    // A form seen twice with one submission would read as 50% on a
    // simple mean, swamping one seen 400 times.
    const overview = buildFormOverview({
      forms: [
        form({ id: "tiny", views: 2 }),
        form({ id: "big", views: 398 }),
      ],
      submissions: [
        submission({ id: "s1", formId: "tiny" }),
        submission({ id: "s2", formId: "big" }),
        submission({ id: "s3", formId: "big" }),
      ],
      since: SINCE,
    });
    // 3 submissions over 400 views, not (50% + 0.5%) / 2.
    expect(overview.conversionRate).toBeCloseTo(0.75);
  });

  it("is null before any form has been viewed", () => {
    const overview = buildFormOverview({
      forms: [form({ views: 0 })],
      submissions: [],
      since: SINCE,
    });
    expect(overview.conversionRate).toBeNull();
  });

  it("excludes forms that are not live from the rate", () => {
    const overview = buildFormOverview({
      forms: [form({ id: "draft", status: "draft", views: 1000 })],
      submissions: [submission({ formId: "draft" })],
      since: SINCE,
    });
    expect(overview.live).toBe(0);
    expect(overview.conversionRate).toBeNull();
  });

  it("reports how many enquiries actually reached the pipeline", () => {
    const overview = buildFormOverview({
      forms: [form()],
      submissions: [
        submission({ id: "s1" }),
        submission({ id: "s2", dealId: null }),
        submission({ id: "s3", submittedAt: OLD }),
      ],
      since: SINCE,
    });
    expect(overview.submissionsInWindow).toBe(2);
    expect(overview.becameDeals).toBe(1);
  });
});

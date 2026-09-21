import type {
  AutomationRunRow,
  AutomationSendRow,
  FormRow,
  FormSubmissionRow,
} from "@/lib/db/schema";

/**
 * The dashboard's roll-up across the modules that are not campaigns.
 *
 * Pure aggregation over rows the caller has already fetched, so the
 * numbers on the front page are testable without standing up the whole
 * app — and so "what counts as in progress" is written down once rather
 * than re-derived in a template.
 */

export interface AutomationOverview {
  /** Sequences currently enrolling people. */
  live: number;
  /** Contacts partway through a sequence right now. */
  inProgress: number;
  /** Contacts who have reached an exit. */
  completed: number;
  /** Emails the sequences sent in the window. */
  sentInWindow: number;
  /** Opt-outs that happened during a sequence, in the window. */
  unsubscribedInWindow: number;
}

export function buildAutomationOverview(input: {
  automations: Array<{ status: string }>;
  runs: AutomationRunRow[];
  sends: AutomationSendRow[];
  since: Date;
}): AutomationOverview {
  return {
    live: input.automations.filter((a) => a.status === "live").length,
    inProgress: input.runs.filter((r) => r.status === "waiting").length,
    // "done" and "exited" are both finished; exited means they opted out
    // partway, which still counts as no longer in progress.
    completed: input.runs.filter(
      (r) => r.status === "done" || r.status === "exited",
    ).length,
    sentInWindow: input.sends.filter(
      (s) => s.sentAt !== null && s.sentAt >= input.since,
    ).length,
    unsubscribedInWindow: input.sends.filter(
      (s) => s.unsubscribedAt !== null && s.unsubscribedAt >= input.since,
    ).length,
  };
}

export interface FormOverview {
  live: number;
  /** Enquiries received in the window. */
  submissionsInWindow: number;
  /** How many of those became a pipeline deal. */
  becameDeals: number;
  /**
   * Conversion across live forms, weighted by views rather than a mean
   * of per-form rates — otherwise a form seen twice and submitted once
   * swamps one seen four hundred times. Null when nothing has been
   * viewed yet.
   */
  conversionRate: number | null;
}

export function buildFormOverview(input: {
  forms: FormRow[];
  submissions: FormSubmissionRow[];
  since: Date;
}): FormOverview {
  const live = input.forms.filter((f) => f.status === "live");
  const inWindow = input.submissions.filter((s) => s.submittedAt >= input.since);

  const liveIds = new Set(live.map((f) => f.id));
  const views = live.reduce((sum, f) => sum + f.views, 0);
  const liveSubmissions = input.submissions.filter((s) => liveIds.has(s.formId));

  return {
    live: live.length,
    submissionsInWindow: inWindow.length,
    becameDeals: inWindow.filter((s) => s.dealId !== null).length,
    conversionRate: views > 0 ? (liveSubmissions.length / views) * 100 : null,
  };
}

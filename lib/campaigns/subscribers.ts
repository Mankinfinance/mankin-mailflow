import type { Deal } from "@/lib/clients/salestrekker/types";
import type { SettlementRow } from "@/lib/commission-parser";
import type { CampaignRecipientRow, EmailSuppressionRow } from "@/lib/db/schema";

/**
 * The contact list behind /marketing/subscribers.
 *
 * Assembled from the two datasets a campaign can draw on plus the
 * suppression register, so what this page shows and what an audience
 * actually resolves to can never drift apart.
 *
 * A note on the word "subscriber". Nobody here subscribed. These are
 * clients of the firm, and the lawful basis for marketing to them under
 * the Spam Act is the existing business relationship, not an opt-in. The
 * date column is therefore "client since", derived from when the
 * relationship began — a "subscribed" column would imply a consent
 * record we do not hold and could not produce if asked for it.
 */

export type SubscriberSource = "back-book" | "pipeline" | "added";
export type SubscriberStatus = "active" | "unsubscribed" | "bounced";

export interface Subscriber {
  /** Lower-cased address — the identity across both datasets. */
  email: string;
  name: string;
  source: SubscriberSource;
  /** Underlying record id, for the detail panel. */
  sourceId: string;
  status: SubscriberStatus;
  /** ISO yyyy-mm-dd when the relationship began, or null when unknown. */
  since: string | null;
  brokerId: string;
  /** Loan context — populated for back-book contacts. */
  loan: {
    lender: string;
    settledOn: string | null;
    currentBalance: number | null;
    loanAmount: number | null;
    loanStatus: string | null;
    /** Pipeline contacts carry a stage instead of a settlement. */
    stageId: string | null;
  };
}

export interface SubscriberCounts {
  active: number;
  unsubscribed: number;
  bounced: number;
  backBook: number;
  pipeline: number;
  added: number;
}

/**
 * Build the list. Back-book first, so a client who is also mid-application
 * keeps their richer record — the same precedence the audience resolver
 * uses, for the same reason.
 */
export function buildSubscribers(input: {
  settlements: SettlementRow[];
  deals: Deal[];
  suppressions: EmailSuppressionRow[];
  /** Mailflow's own list. Last, so a loan or deal record wins. */
  contacts?: Array<{ email: string; name: string; brokerId: string; createdAt: Date }>;
}): Subscriber[] {
  const statusByEmail = new Map<string, SubscriberStatus>();
  for (const s of input.suppressions) {
    statusByEmail.set(
      s.email.toLowerCase(),
      s.reason === "bounce" ? "bounced" : "unsubscribed",
    );
  }

  const out: Subscriber[] = [];
  const seen = new Set<string>();

  for (const s of input.settlements) {
    const email = s.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: s.clientName,
      source: "back-book",
      sourceId: s.id,
      status: statusByEmail.get(email) ?? "active",
      since: s.settlementDate || null,
      brokerId: s.brokerId ?? "",
      loan: {
        lender: s.lender,
        settledOn: s.settlementDate || null,
        currentBalance: s.currentBalance,
        loanAmount: s.settlementAmount,
        loanStatus: s.loanStatus,
        stageId: null,
      },
    });
  }

  for (const d of input.deals) {
    const email = d.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: d.name,
      source: "pipeline",
      sourceId: d.id,
      status: statusByEmail.get(email) ?? "active",
      since: d.systemAddedAt ? d.systemAddedAt.slice(0, 10) : null,
      brokerId: d.brokerId,
      loan: {
        lender: d.lender,
        settledOn: null,
        currentBalance: null,
        loanAmount: d.loanAmount,
        loanStatus: null,
        stageId: d.stageId,
      },
    });
  }

  for (const c of input.contacts ?? []) {
    const email = c.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: c.name || email,
      source: "added",
      sourceId: email,
      status: statusByEmail.get(email) ?? "active",
      since: c.createdAt.toISOString().slice(0, 10),
      brokerId: c.brokerId,
      loan: {
        lender: "",
        settledOn: null,
        currentBalance: null,
        loanAmount: null,
        loanStatus: null,
        stageId: null,
      },
    });
  }

  return out;
}

export function countSubscribers(subscribers: Subscriber[]): SubscriberCounts {
  return {
    active: subscribers.filter((s) => s.status === "active").length,
    unsubscribed: subscribers.filter((s) => s.status === "unsubscribed").length,
    bounced: subscribers.filter((s) => s.status === "bounced").length,
    backBook: subscribers.filter((s) => s.source === "back-book").length,
    pipeline: subscribers.filter((s) => s.source === "pipeline").length,
    added: subscribers.filter((s) => s.source === "added").length,
  };
}

export interface SubscriberFilter {
  /** Matched against name and email, case-insensitively. */
  search?: string;
  source?: SubscriberSource | "all";
  status?: SubscriberStatus | "all";
  /** Keep only contacts carrying this tag. */
  tag?: string | "all";
  /** Tags per lower-cased email. Required only when `tag` is set. */
  tagsByEmail?: Record<string, string[]>;
}

export function filterSubscribers(
  subscribers: Subscriber[],
  filter: SubscriberFilter,
): Subscriber[] {
  const needle = filter.search?.trim().toLowerCase() ?? "";
  /* Case-insensitive, matching the campaign audience filter — the two
     have to agree, or a broker filters to 40 contacts here and then
     mails a different 40. */
  const wantedTag =
    filter.tag && filter.tag !== "all" ? filter.tag.toLowerCase() : null;

  return subscribers.filter((s) => {
    if (filter.source && filter.source !== "all" && s.source !== filter.source) {
      return false;
    }
    if (filter.status && filter.status !== "all" && s.status !== filter.status) {
      return false;
    }
    if (wantedTag) {
      const tags = (filter.tagsByEmail?.[s.email] ?? []).map((t) =>
        t.toLowerCase(),
      );
      if (!tags.includes(wantedTag)) return false;
    }
    if (!needle) return true;
    return (
      s.name.toLowerCase().includes(needle) || s.email.includes(needle)
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                   */
/* -------------------------------------------------------------------------- */

export interface ActivityEvent {
  kind: "sent" | "opened" | "clicked" | "unsubscribed" | "added" | "enquiry" | "survey";
  /** Campaign name, or the provenance line for the "added" event. */
  label: string;
  detail: string;
  at: Date;
}

/**
 * One contact's history across every campaign, newest first.
 *
 * Derived from the recipient rows rather than a separate event log: the
 * recipient row already carries every timestamp we record, and a second
 * store of the same facts is a second store to keep in step.
 */
export function buildActivity(
  subscriber: Subscriber,
  recipients: CampaignRecipientRow[],
  campaignNames: Map<string, string>,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const r of recipients) {
    if (r.email !== subscriber.email) continue;
    const campaign = campaignNames.get(r.campaignId) ?? "A campaign";
    if (r.sentAt) {
      events.push({
        kind: "sent",
        label: campaign,
        detail: "Delivered to the mail server",
        at: r.sentAt,
      });
    }
    if (r.openedAt) {
      events.push({ kind: "opened", label: campaign, detail: "Opened", at: r.openedAt });
    }
    if (r.clickedAt) {
      events.push({
        kind: "clicked",
        label: campaign,
        detail: "Clicked a link",
        at: r.clickedAt,
      });
    }
    if (r.unsubscribedAt) {
      events.push({
        kind: "unsubscribed",
        label: campaign,
        detail: "Unsubscribed from the footer",
        at: r.unsubscribedAt,
      });
    }
  }

  if (subscriber.since) {
    const at = new Date(subscriber.since);
    if (!Number.isNaN(at.getTime())) {
      events.push({
        kind: "added",
        label:
          subscriber.source === "back-book"
            ? "Added from the aggregator file"
            : "Added from the loan pipeline",
        detail:
          subscriber.source === "back-book"
            ? "Back-book import"
            : "New application",
        at,
      });
    }
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * The rest of a contact's history: sequence emails, form enquiries and
 * survey answers. Loaded for one contact when their panel opens, rather
 * than for the whole list, and merged with the campaign events above.
 */
export function buildHistoryEvents(input: {
  sends: Array<{
    automationId: string;
    sentAt: Date | null;
    openedAt: Date | null;
    clickedAt: Date | null;
    unsubscribedAt: Date | null;
  }>;
  automationNames: Map<string, string>;
  submissions: Array<{
    formId: string;
    submittedAt: Date;
    dealId: string | null;
    consentStatus?: string;
    confirmedAt?: Date | null;
  }>;
  formNames: Map<string, string>;
  responses: Array<{ surveyId: string; submittedAt: Date; answers: unknown }>;
  surveyNames: Map<string, string>;
}): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const s of input.sends) {
    const label = `Sequence: ${input.automationNames.get(s.automationId) ?? "a sequence"}`;
    if (s.sentAt) events.push({ kind: "sent", label, detail: "Sequence email delivered", at: s.sentAt });
    if (s.openedAt) events.push({ kind: "opened", label, detail: "Opened", at: s.openedAt });
    if (s.clickedAt) events.push({ kind: "clicked", label, detail: "Clicked a link", at: s.clickedAt });
    if (s.unsubscribedAt) events.push({ kind: "unsubscribed", label, detail: "Unsubscribed", at: s.unsubscribedAt });
  }
  for (const f of input.submissions) {
    events.push({
      kind: "enquiry",
      label: `Form: ${input.formNames.get(f.formId) ?? "an enquiry form"}`,
      detail: [
        f.dealId ? "Sent an enquiry, now a deal in the pipeline" : "Sent an enquiry",
        consentNote(f.consentStatus, f.confirmedAt ?? null),
      ]
        .filter(Boolean)
        .join(". "),
      at: f.submittedAt,
    });
  }
  for (const r of input.responses) {
    const answers = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
    const score = Object.values(answers).find((v) => typeof v === "number" && v >= 0 && v <= 10);
    events.push({
      kind: "survey",
      label: `Survey: ${input.surveyNames.get(r.surveyId) ?? "a survey"}`,
      detail: typeof score === "number" ? `Answered, scoring ${score} out of 10` : "Answered",
      at: r.submittedAt,
    });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The marketing-permission half of an enquiry's timeline line. */
function consentNote(status: string | undefined, confirmedAt: Date | null): string {
  switch (status) {
    case "declined":
      return "Didn't tick the box for marketing emails";
    case "opted-in":
      return "Ticked the box for marketing emails";
    case "pending":
      return "Ticked the box for marketing emails; not confirmed by email yet";
    case "confirmed":
      return confirmedAt
        ? `Ticked the box for marketing emails and confirmed by email on ${confirmedAt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
        : "Ticked the box for marketing emails and confirmed by email";
    default:
      return "";
  }
}

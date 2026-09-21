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

export type SubscriberSource = "back-book" | "pipeline";
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

  return out;
}

export function countSubscribers(subscribers: Subscriber[]): SubscriberCounts {
  return {
    active: subscribers.filter((s) => s.status === "active").length,
    unsubscribed: subscribers.filter((s) => s.status === "unsubscribed").length,
    bounced: subscribers.filter((s) => s.status === "bounced").length,
    backBook: subscribers.filter((s) => s.source === "back-book").length,
    pipeline: subscribers.filter((s) => s.source === "pipeline").length,
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
  kind: "sent" | "opened" | "clicked" | "unsubscribed" | "added";
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

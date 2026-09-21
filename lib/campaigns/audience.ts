import type { Deal } from "@/lib/clients/salestrekker/types";
import type { SettlementRow } from "@/lib/commission-parser";
import { dealGreetingFirstName } from "@/lib/deal-subjects";
import { teamMember } from "@/lib/team";
import type { AudienceFilter, AudienceMember } from "./types";

/**
 * Resolve a campaign's audience filter into a concrete recipient list.
 *
 * Pure module — feed it the back-book rows and the pipeline deals, get
 * back the people to mail. The suppression list is applied later, at the
 * send choke point (lib/campaigns/send.ts), because a customer can
 * unsubscribe in the gap between a broker resolving an audience and the
 * cron actually dispatching it.
 *
 * Two things this deliberately does NOT do:
 *  - It never invents an address. A back-book row with no email on the
 *    commission sheet is dropped rather than guessed at from the deal
 *    list, because matching on name alone would eventually mail the
 *    wrong Sarah Chen.
 *  - It never returns the same address twice. A customer who settled
 *    last year and has a new application open appears in both datasets;
 *    they get one email, from the settlement record (the richer one).
 */

/** Merge values every recipient carries, whatever dataset they came
 *  from — so a body written against {{first_name}} works for both. */
function baseFields(brokerId: string): Record<string, string> {
  const broker = teamMember(brokerId);
  return {
    broker_name: broker.name,
    broker_first_name: broker.short,
    broker_phone: broker.phone,
    broker_email: broker.email,
    booking_url: broker.bookingUrl ?? "",
  };
}

/** "Chen, Sarah" and "Sarah Chen" both give "Chen". Empty when the row
 *  carries a single-word name, which the merge renderer turns into a
 *  blank rather than guessing. */
function lastNameOf(clientName: string): string {
  const raw = clientName.trim();
  if (!raw) return "";
  if (raw.includes(",")) return raw.split(",")[0].trim();
  const parts = raw.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

/** "Chen, Sarah" and "Sarah Chen" both give "Sarah". */
function firstNameOf(clientName: string): string {
  const raw = clientName.trim();
  if (!raw) return "there";
  // The commission sheet writes "Last, First" — the parser normalises
  // most rows, but a stray one still arrives comma-form.
  if (raw.includes(",")) {
    const after = raw.split(",")[1]?.trim();
    if (after) return after.split(/\s+/)[0];
  }
  return raw.split(/\s+/)[0] || "there";
}

function formatAud(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-AU")}`;
}

/** Whole years between settlement and today, floored at 0. */
function yearsSince(settlementDate: string, today: Date): number {
  const settled = new Date(settlementDate);
  if (Number.isNaN(settled.getTime())) return 0;
  const years =
    (today.getTime() - settled.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(years));
}

/** Format an ISO date the way an Australian customer reads it. */
function formatAuDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Does this back-book row pass the filter? */
function settlementMatches(
  s: SettlementRow,
  filter: AudienceFilter,
): boolean {
  // loanStatus can also be "unknown", which no filter ever selects.
  if (!(filter.loanStatus as string[]).includes(s.loanStatus)) return false;
  if (filter.brokerIds.length && !filter.brokerIds.includes(s.brokerId ?? "")) {
    return false;
  }
  if (filter.lenderCodes.length && !filter.lenderCodes.includes(s.lenderCode)) {
    return false;
  }
  // Settlement dates are ISO yyyy-mm-dd, so string compare is date compare.
  if (filter.settledFrom && s.settlementDate < filter.settledFrom) return false;
  if (filter.settledTo && s.settlementDate > filter.settledTo) return false;
  if (filter.minBalance !== null && s.currentBalance < filter.minBalance) {
    return false;
  }
  if (filter.maxBalance !== null && s.currentBalance > filter.maxBalance) {
    return false;
  }
  return true;
}

/** Does this pipeline deal pass the filter? */
function dealMatches(deal: Deal, filter: AudienceFilter): boolean {
  if (filter.brokerIds.length && !filter.brokerIds.includes(deal.brokerId)) {
    return false;
  }
  if (filter.stageIds.length && !filter.stageIds.includes(deal.stageId)) {
    return false;
  }
  if (!filter.includeNurtured && deal.nurturedAt !== null) return false;
  if (
    filter.excludeContactedWithinDays !== null &&
    deal.daysSinceContact < filter.excludeContactedWithinDays
  ) {
    return false;
  }
  // The broker's per-deal "leave this customer alone" switch. It exists
  // for the daily update emails; a marketing blast is exactly the kind
  // of thing it should also hold back.
  if (deal.excludeFromDailyUpdates) return false;
  return true;
}

function settlementToMember(
  s: SettlementRow,
  today: Date,
): AudienceMember | null {
  const email = s.email.trim().toLowerCase();
  if (!email) return null;
  const brokerId = s.brokerId ?? "";
  return {
    email,
    name: s.clientName,
    firstName: firstNameOf(s.clientName),
    sourceKind: "settlements",
    sourceId: s.id,
    brokerId,
    fields: {
      ...baseFields(brokerId),
      first_name: firstNameOf(s.clientName),
      last_name: lastNameOf(s.clientName),
      full_name: s.clientName,
      lender: s.lender,
      loan_status: s.loanStatus,
      loan_amount: formatAud(s.settlementAmount),
      current_balance: formatAud(s.currentBalance),
      settlement_date: formatAuDate(s.settlementDate),
      years_since_settlement: String(yearsSince(s.settlementDate, today)),
    },
  };
}

function dealToMember(deal: Deal): AudienceMember | null {
  const email = deal.email.trim().toLowerCase();
  if (!email) return null;
  const firstName = dealGreetingFirstName(deal);
  return {
    email,
    name: deal.name,
    firstName,
    sourceKind: "deals",
    sourceId: deal.id,
    brokerId: deal.brokerId,
    fields: {
      ...baseFields(deal.brokerId),
      first_name: firstName,
      last_name: lastNameOf(deal.name),
      full_name: deal.name,
      lender: deal.lender,
      loan_status: "",
      loan_amount: deal.loanAmount === null ? "" : formatAud(deal.loanAmount),
      current_balance: "",
      settlement_date: "",
      years_since_settlement: "",
    },
  };
}

export interface ResolveAudienceInput {
  filter: AudienceFilter;
  settlements: SettlementRow[];
  deals: Deal[];
  /**
   * Tags per lower-cased email. Passed in rather than looked up here so
   * this module stays pure — the tag store is a table, and resolving an
   * audience has to be testable without one.
   */
  tagsByEmail?: Record<string, string[]>;
  /**
   * When present, only these addresses may be selected — the follow-up
   * case, where the audience is a subset of an earlier campaign's
   * recipients. Undefined means no restriction; an empty array means
   * nobody, which is the honest answer when everyone opened it.
   */
  restrictToEmails?: string[];
  /** Injected so the "years since settlement" merge field is testable. */
  today?: Date;
}

export interface ResolvedAudience {
  members: AudienceMember[];
  /** Contacts dropped for having no email address on file. */
  droppedNoEmail: number;
  /** Contacts dropped because an earlier source already claimed the
   *  address. Shown in the UI so a broker can see why 400 matching
   *  records became 380 recipients. */
  droppedDuplicate: number;
  /** Contacts dropped by the tag filter, for the same reason. */
  droppedByTag: number;
  /** Contacts dropped for not being in the restriction set. */
  droppedNotInSet: number;
}

/**
 * Build the recipient list. Settlements are processed first so a
 * customer who appears in both datasets is mailed with their back-book
 * merge fields (lender, balance, settlement date) rather than the
 * sparser pipeline ones.
 */
export function resolveAudience(input: ResolveAudienceInput): ResolvedAudience {
  const { filter, settlements, deals } = input;
  const today = input.today ?? new Date();

  const members: AudienceMember[] = [];
  const seen = new Set<string>();
  let droppedNoEmail = 0;
  let droppedDuplicate = 0;
  let droppedByTag = 0;
  let droppedNotInSet = 0;

  const restrictTo =
    input.restrictToEmails === undefined
      ? null
      : new Set(input.restrictToEmails);

  /* Tag comparison is case-insensitive: a broker who typed "Investor"
     on Monday and "investor" on Friday meant the same label, and a
     filter that disagreed would silently mail half the group. */
  const tagsByEmail = input.tagsByEmail ?? {};
  const include = new Set(filter.includeTags.map((t) => t.toLowerCase()));
  const exclude = new Set(filter.excludeTags.map((t) => t.toLowerCase()));

  const tagsAllow = (email: string): boolean => {
    if (include.size === 0 && exclude.size === 0) return true;
    const tags = (tagsByEmail[email] ?? []).map((t) => t.toLowerCase());
    // Exclusion wins: "not this group" is the stronger instruction.
    if (tags.some((t) => exclude.has(t))) return false;
    if (include.size === 0) return true;
    return tags.some((t) => include.has(t));
  };

  const take = (member: AudienceMember | null): void => {
    if (!member) {
      droppedNoEmail += 1;
      return;
    }
    if (seen.has(member.email)) {
      droppedDuplicate += 1;
      return;
    }
    // Claim the address either way, so a contact rejected here is not
    // then admitted by the other source under looser merge fields.
    seen.add(member.email);
    if (restrictTo !== null && !restrictTo.has(member.email)) {
      droppedNotInSet += 1;
      return;
    }
    if (!tagsAllow(member.email)) {
      droppedByTag += 1;
      return;
    }
    members.push(member);
  };

  if (filter.sources.includes("settlements")) {
    for (const s of settlements) {
      if (!settlementMatches(s, filter)) continue;
      take(settlementToMember(s, today));
    }
  }

  if (filter.sources.includes("deals")) {
    for (const deal of deals) {
      if (!dealMatches(deal, filter)) continue;
      take(dealToMember(deal));
    }
  }

  return {
    members,
    droppedNoEmail,
    droppedDuplicate,
    droppedByTag,
    droppedNotInSet,
  };
}

/** Every merge field the audience layer can supply, for the editor's
 *  "available fields" hint. Kept beside the builders above so the two
 *  can't drift. */
export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "lender",
  "loan_amount",
  "current_balance",
  "settlement_date",
  "years_since_settlement",
  "loan_status",
  "broker_name",
  "broker_first_name",
  "broker_phone",
  "broker_email",
  "booking_url",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

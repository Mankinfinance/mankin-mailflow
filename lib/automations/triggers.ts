import type { Deal } from "@/lib/clients/salestrekker/types";
import type { SettlementRow } from "@/lib/commission-parser";
import type { Trigger } from "./types";

/**
 * Who enters a sequence today.
 *
 * Pure. Feed it the book and the trigger; it returns the contacts that
 * became eligible, with the merge context frozen at the moment they
 * entered — the same freeze a campaign does, and for the same reason.
 *
 * The rule that shapes all of this: a contact enters a given automation
 * once, ever. The runner enforces that against existing runs; these
 * functions only answer "is today their day", which is what makes them
 * testable without a database.
 */

export interface TriggerHit {
  email: string;
  name: string;
  firstName: string;
  sourceKind: "settlements" | "deals";
  sourceId: string;
  brokerId: string;
  /** Merge values, frozen at entry. */
  fields: Record<string, string>;
}

/**
 * Whether a settlement hits its Nth-month anniversary within the window
 * ending today.
 *
 * The window exists because the cron runs daily and a day can be missed
 * — a deploy, an outage, a month with a 29th. Without it, everyone whose
 * anniversary fell on the missed day never enters at all, silently.
 */
export function isAnniversaryDue(
  settlementDate: string,
  months: number,
  today: Date,
  windowDays = 3,
): boolean {
  const settled = new Date(settlementDate);
  if (Number.isNaN(settled.getTime())) return false;

  const due = new Date(settled);
  due.setMonth(due.getMonth() + months);

  const daysUntil = Math.round(
    (startOfDay(due).getTime() - startOfDay(today).getTime()) / 86_400_000,
  );
  // Due today, or up to windowDays ago — never in the future.
  return daysUntil <= 0 && daysUntil > -windowDays;
}

/** Days a deal has been sitting in its current stage. */
export function daysInStage(deal: Deal, today: Date): number | null {
  const entered = deal.stageEnteredAt;
  if (!entered) return null;
  return Math.floor(
    (startOfDay(today).getTime() - startOfDay(new Date(entered)).getTime()) /
      86_400_000,
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** An enquiry that arrived through a form, for the signup trigger. */
export interface SubmissionHit {
  formId: string;
  email: string;
  name: string;
  submittedAt: Date;
  /** The deal it became, when the form routes to the pipeline. */
  dealId: string | null;
}

/** A label applied to a contact, for the tag trigger. */
export interface TagHit {
  email: string;
  tag: string;
  addedAt: Date;
}

export interface EvaluateTriggerInput {
  trigger: Trigger;
  settlements: SettlementRow[];
  deals: Deal[];
  today: Date;
  /** Form enquiries, for kind "form-submission". */
  submissions?: SubmissionHit[];
  /** Tags applied, for kind "tag-added". */
  tagEvents?: TagHit[];
  /** Contacts already in this automation — never enrolled twice. */
  alreadyEnrolled: ReadonlySet<string>;
  /** The do-not-market register. Checked here as well as at send time. */
  suppressed: ReadonlySet<string>;
  /** Merge field builder, shared with the campaign audience resolver so
   *  an automation email and a campaign email merge identically. */
  fieldsForSettlement: (s: SettlementRow) => Record<string, string>;
  fieldsForDeal: (d: Deal) => Record<string, string>;
}

export function evaluateTrigger(input: EvaluateTriggerInput): TriggerHit[] {
  const { trigger, today, alreadyEnrolled, suppressed } = input;
  const hits: TriggerHit[] = [];

  const eligible = (email: string) =>
    Boolean(email) && !alreadyEnrolled.has(email) && !suppressed.has(email);

  if (trigger.kind === "form-submission") {
    /* An enquiry is its own evidence of entry, so there is no window to
       widen here the way the anniversary needs one — a submission that
       arrived while the cron was down is still sitting in the table
       waiting to be picked up, and `alreadyEnrolled` stops it being
       picked up twice. */
    for (const sub of input.submissions ?? []) {
      if (sub.formId !== trigger.formId) continue;
      const email = sub.email.trim().toLowerCase();
      if (!eligible(email)) continue;

      /* Prefer the deal the enquiry created: it carries the merge
         context. Without one we still enrol, on the name and address
         the form collected — a welcome sequence should not be
         contingent on the pipeline write having succeeded. */
      const deal = sub.dealId
        ? input.deals.find((d) => d.id === sub.dealId)
        : undefined;
      const fields = deal ? input.fieldsForDeal(deal) : {};

      hits.push({
        email,
        name: deal?.name ?? sub.name,
        firstName: fields.first_name ?? firstNameOf(sub.name),
        sourceKind: "deals",
        sourceId: sub.dealId ?? sub.formId,
        brokerId: deal?.brokerId ?? "",
        fields,
      });
    }
    return hits;
  }

  if (trigger.kind === "tag-added") {
    const wanted = trigger.tag.trim().toLowerCase();
    for (const event of input.tagEvents ?? []) {
      if (event.tag.trim().toLowerCase() !== wanted) continue;
      const email = event.email.trim().toLowerCase();
      if (!eligible(email)) continue;

      /* A tag is on an address, which is the one identity that spans
         both datasets — so resolve the richer record the way the
         subscriber list does, back-book first. */
      const settlement = input.settlements.find(
        (x) => x.email.trim().toLowerCase() === email,
      );
      if (settlement) {
        const fields = input.fieldsForSettlement(settlement);
        hits.push({
          email,
          name: settlement.clientName,
          firstName: fields.first_name ?? "there",
          sourceKind: "settlements",
          sourceId: settlement.id,
          brokerId: settlement.brokerId ?? "",
          fields,
        });
        continue;
      }
      const deal = input.deals.find(
        (x) => x.email.trim().toLowerCase() === email,
      );
      if (!deal) continue;
      const fields = input.fieldsForDeal(deal);
      hits.push({
        email,
        name: deal.name,
        firstName: fields.first_name ?? "there",
        sourceKind: "deals",
        sourceId: deal.id,
        brokerId: deal.brokerId,
        fields,
      });
    }
    return hits;
  }

  if (trigger.kind === "equity-milestone") {
    for (const s of input.settlements) {
      if (s.loanStatus !== "active") continue;
      const email = s.email.trim().toLowerCase();
      if (!eligible(email)) continue;
      const paid = percentPaidDown(s);
      if (paid === null || paid < trigger.percentPaidDown) continue;

      const fields = input.fieldsForSettlement(s);
      hits.push({
        email,
        name: s.clientName,
        firstName: fields.first_name ?? "there",
        sourceKind: "settlements",
        sourceId: s.id,
        brokerId: s.brokerId ?? "",
        fields,
      });
    }
    return hits;
  }

  if (trigger.kind === "settlement-anniversary") {
    for (const s of input.settlements) {
      // Only live loans: a discharged loan's anniversary is not an
      // occasion to write about reviewing it.
      if (s.loanStatus !== "active") continue;
      const email = s.email.trim().toLowerCase();
      if (!eligible(email)) continue;
      if (!isAnniversaryDue(s.settlementDate, trigger.months, today)) continue;

      const fields = input.fieldsForSettlement(s);
      hits.push({
        email,
        name: s.clientName,
        firstName: fields.first_name ?? "there",
        sourceKind: "settlements",
        sourceId: s.id,
        brokerId: s.brokerId ?? "",
        fields,
      });
    }
    return hits;
  }

  /* Everything else has returned by here; this is the pipeline-stage
     case. Named explicitly rather than left as the fall-through so
     adding a trigger kind is a type error here instead of silently
     being treated as a stage trigger. */
  if (trigger.kind !== "pipeline-stage") return hits;

  for (const d of input.deals) {
    if (d.stageId !== trigger.stageId) continue;
    if (d.excludeFromDailyUpdates) continue;
    const email = d.email.trim().toLowerCase();
    if (!eligible(email)) continue;

    const inStage = daysInStage(d, today);
    if (inStage === null || inStage < trigger.afterDays) continue;

    const fields = input.fieldsForDeal(d);
    hits.push({
      email,
      name: d.name,
      firstName: fields.first_name ?? "there",
      sourceKind: "deals",
      sourceId: d.id,
      brokerId: d.brokerId,
      fields,
    });
  }
  return hits;
}

/**
 * How much of the original loan has been paid off, as a percentage.
 *
 * Null when the settlement amount is missing or zero — a percentage of
 * nothing is not zero percent, it is unknown, and a loan with no
 * recorded starting balance would otherwise read as fully paid.
 */
export function percentPaidDown(s: {
  settlementAmount: number;
  currentBalance: number;
}): number | null {
  if (!s.settlementAmount || s.settlementAmount <= 0) return null;
  if (s.currentBalance < 0) return null;
  const paid = s.settlementAmount - s.currentBalance;
  /* A redraw or a top-up can put the balance above what it started at.
     That is not negative progress worth acting on, it is a different
     conversation — so it reads as zero rather than a negative share. */
  if (paid <= 0) return 0;
  return (paid / s.settlementAmount) * 100;
}

function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

/** Human summary of a trigger, for the canvas and the list. */
export function describeTrigger(
  trigger: Trigger,
  stageLabel?: string,
  formName?: string,
): string {
  if (trigger.kind === "form-submission") {
    return `Someone enquires through ${formName ?? "a form"}`;
  }
  if (trigger.kind === "tag-added") {
    /* Blank on a template card, where the tag is still the broker's to
       pick. `A contact is tagged ""` reads as a bug rather than as a
       decision waiting to be made. */
    return trigger.tag.trim()
      ? `A contact is tagged "${trigger.tag}"`
      : "A contact is tagged with a label you choose";
  }
  if (trigger.kind === "equity-milestone") {
    return `A loan passes ${trigger.percentPaidDown}% paid down`;
  }
  if (trigger.kind === "settlement-anniversary") {
    return trigger.months === 12
      ? "A loan passes its 12-month settlement anniversary"
      : `A loan passes its ${trigger.months}-month settlement anniversary`;
  }
  const stage = stageLabel ?? trigger.stageId;
  return trigger.afterDays === 0
    ? `A deal reaches ${stage}`
    : `A deal has been at ${stage} for ${trigger.afterDays} days`;
}

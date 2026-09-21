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

export interface EvaluateTriggerInput {
  trigger: Trigger;
  settlements: SettlementRow[];
  deals: Deal[];
  today: Date;
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

/** Human summary of a trigger, for the canvas and the list. */
export function describeTrigger(trigger: Trigger, stageLabel?: string): string {
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

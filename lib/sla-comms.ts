import type { Deal } from "./clients/salestrekker/types";
import type { DealSlaStatus } from "./lender-sla";
import { parseLenderField } from "./lenders";

/**
 * Turns a deal's SLA status into wording for comms and reports.
 *
 * Customer-facing lines are deliberately SOFT: they set expectations
 * ("currently taking around a week") without promising a date, and when a
 * deal is past the lender's turnaround they frame it as us actively
 * chasing rather than as a failure. Returns null when there are no SLA
 * figures for the deal's lender, so comms simply omit the timeframe.
 */

function lenderDisplayName(deal: Deal): string {
  const { lenderName } = parseLenderField(deal.lender);
  return lenderName ?? "the lender";
}

/** A soft, customer-facing sentence about where the lender-side wait is
 *  up to, or null when we can't say anything useful. */
export function slaCustomerSentence(
  deal: Deal,
  status: DealSlaStatus,
): string | null {
  if (!status.key || status.expectedDays === null || !status.customerTask) {
    return null;
  }
  const lender = lenderDisplayName(deal);
  const task = status.customerTask; // "assessment" | "formal approval" | "pre-approval"

  if (status.overdue) {
    return `Your file is with ${lender} for ${task}. It's sitting a little past their usual turnaround of around ${status.expectedDays} business days, so I'm following up with them directly for an update.`;
  }

  const remaining =
    status.daysInStage !== null ? status.expectedDays - status.daysInStage : null;
  let when: string;
  if (remaining === null) when = "shortly";
  else if (remaining <= 1) when = "any day now";
  else if (remaining <= 3) when = "in the next few days";
  else when = `within about ${remaining} business days`;

  return `Your file is with ${lender} for ${task}, which is currently taking around ${status.expectedDays} business days. On that basis I'd expect to hear back ${when}.`;
}

/** A compact internal note for the priority / EOD reports, or null. */
export function slaInternalNote(status: DealSlaStatus): string | null {
  if (
    !status.label ||
    status.expectedDays === null ||
    status.daysInStage === null
  ) {
    return null;
  }
  const base = `${status.label}: ${status.daysInStage}bd in vs ${status.expectedDays}bd SLA`;
  return status.overdue ? `${base} (${status.overdueBy}bd over)` : base;
}

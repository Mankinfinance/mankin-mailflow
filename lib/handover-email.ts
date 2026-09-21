import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { stageMeta } from "@/lib/clients/salestrekker/types";
import { docName } from "@/lib/clients/salestrekker/doc-catalog";
import { dealGreetingFirstName, subjectWithMankin } from "@/lib/deal-subjects";
import { formatTimestampAU } from "@/lib/format-date";

/**
 * Handover introduction email. Generated when a deal is reassigned
 * because the original broker is going on (or already on) leave.
 *
 * Voice rules:
 *   - From the original broker (the one going on leave). They own the
 *     existing relationship so the introduction lands warmer.
 *   - CCs the new covering broker so they're on the chain when the
 *     customer replies.
 *   - Single update paragraph summarising where the deal is at.
 *   - Closing line names the new broker by full name + leave dates so
 *     the customer can plan accordingly.
 *
 * Output goes into the deal timeline as a draft email. Until real
 * Graph /me/sendMail is wired in Phase 7, the broker copies it into
 * Outlook and hits send (with the CC already in the recipients line).
 */

export interface HandoverEmailInput {
  deal: Deal;
  /** Original broker (going on leave / on leave) */
  fromBroker: {
    name: string;
    short: string;
    email: string;
    phone: string;
  };
  /** New broker covering (CC'd on the email) */
  toBroker: {
    name: string;
    short: string;
    email: string;
    phone: string;
  };
  /** When the original broker leaves */
  leaveStartAt: Date;
  /** When the original broker is back, or null if open-ended */
  leaveEndAt: Date | null;
}

export interface HandoverEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

function formatAuDate(date: Date): string {
  return formatTimestampAU(date);
}

function dealStatusBlurb(deal: Deal): string {
  const meta = stageMeta(deal.stageId);
  const lender = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");
  const overdue = deal.overdue.map((id) => docName(deal.customDocs, id));
  const pending = deal.pending.map((id) => docName(deal.customDocs, id));
  const outstanding = [...overdue, ...pending];

  // First sentence: where we are.
  let stagePart: string;
  if (deal.stageId === "pre-lodge") {
    stagePart = `we're in pre-lodgement and still pulling together your assessment docs${lender ? ` for ${lender}` : ""}`;
  } else if (deal.stageId === "lodged") {
    stagePart = `your application is lodged with ${lender || "the lender"} and we're waiting on their initial assessment`;
  } else if (deal.stageId === "cond-approved") {
    stagePart = `${lender || "the lender"} has issued conditional approval and we're working through their conditions`;
  } else if (deal.stageId === "pre-approval") {
    stagePart = `you've got pre-approval with ${lender || "the lender"} and we're now waiting for you to find a property`;
  } else if (deal.stageId === "unconditional") {
    stagePart = `${lender || "the lender"} has issued unconditional approval and loan docs are next`;
  } else if (deal.stageId === "loan-docs") {
    stagePart = `loan documents have been issued from ${lender || "the lender"} and we're working towards settlement`;
  } else if (deal.stageId === "settle-booked") {
    stagePart = `settlement is booked for ${deal.settlement || "(date TBC)"}`;
  } else {
    stagePart = `we're at the ${meta.shortLabel.toLowerCase()} stage`;
  }

  if (outstanding.length === 0) {
    return `${stagePart.charAt(0).toUpperCase() + stagePart.slice(1)}. Nothing outstanding from you at the moment, so just sit tight and we'll be in touch when the next milestone hits.`;
  }

  if (outstanding.length === 1) {
    return `${stagePart.charAt(0).toUpperCase() + stagePart.slice(1)}. The one thing we're still waiting on from you is ${outstanding[0]}.`;
  }

  const docList =
    outstanding.length <= 3
      ? outstanding.slice(0, -1).join(", ") + ", and " + outstanding[outstanding.length - 1]
      : outstanding.slice(0, 3).join(", ") +
        `, and ${outstanding.length - 3} other ${outstanding.length - 3 === 1 ? "item" : "items"}`;
  return `${stagePart.charAt(0).toUpperCase() + stagePart.slice(1)}. The items we're still waiting on from you are ${docList}.`;
}

export function composeHandoverEmail(input: HandoverEmailInput): HandoverEmail {
  const { deal, fromBroker, toBroker, leaveStartAt, leaveEndAt } = input;
  const firstName = dealGreetingFirstName(deal);

  const leaveWindow = leaveEndAt
    ? `from ${formatAuDate(leaveStartAt)} to ${formatAuDate(leaveEndAt)}`
    : `from ${formatAuDate(leaveStartAt)} (return date to be confirmed)`;

  const returnSentence = leaveEndAt
    ? `I'll be back at the desk on ${formatAuDate(leaveEndAt)} and will pick straight back up with you then.`
    : `I'll let you know my return date as soon as it's confirmed. ${toBroker.short} will be your primary point of contact in the meantime.`;

  const body = [
    `Hi ${firstName},`,
    "",
    `Quick heads up. I'm going to be on leave ${leaveWindow}. While I'm away, my colleague ${toBroker.name} (CC'd) will be looking after your application. ${toBroker.short} has been fully briefed on where we're at and how you like to communicate.`,
    "",
    `For context on where we are:`,
    "",
    dealStatusBlurb(deal),
    "",
    `${toBroker.short} can be reached on ${toBroker.phone} or by replying to this email. You'll be in safe hands.`,
    "",
    returnSentence,
    "",
    `If you've got anything you want to flag before I head off, give me a call today on ${fromBroker.phone}.`,
    "",
    `Kind regards,`,
    fromBroker.name,
    `Mankin Finance`,
  ].join("\n");

  return {
    to: deal.email,
    cc: toBroker.email,
    subject: subjectWithMankin("Broker handover", deal),
    body,
  };
}

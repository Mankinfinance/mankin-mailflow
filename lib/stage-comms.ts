import type { Deal, StageId } from "./clients/salestrekker/types";
import { dealGreetingFirstName, subjectWithMankin } from "./deal-subjects";
import { reviewRequestLine } from "./email-signature";

/**
 * Milestone customer emails keyed by deal stage — the positive, timely
 * updates a customer actually wants to hear: conditional approval, formal
 * (unconditional) approval, loan documents, settlement booked, and
 * settled. These sit alongside the existing time-since-settlement
 * anniversary comms; this file covers the run *to* settlement, which had
 * no in-app customer email before.
 *
 * Deterministic and hand-written, mirroring lib/anniversary-content.ts:
 * because these bodies never pass through the Claude output sanitiser,
 * the brand voice is enforced here by writing it correctly — plain
 * Australian English, no exclamation marks, no em dashes, no
 * Americanisms, one clear next step.
 *
 * The settled email folds in the Google review request (the moment of
 * peak goodwill is the right time to ask), pointing at MANKIN_REVIEW_URL.
 */

export interface StageCommsContext {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
  brokerId?: string;
  /** Overrides the default Mankin review link on the settled email. */
  reviewUrl?: string;
}

export interface ComposedStageEmail {
  subject: string;
  body: string;
}

/** Stages that have a customer milestone email, in pipeline order. */
export const STAGE_COMMS_STAGES: readonly StageId[] = [
  "cond-approved",
  "unconditional",
  "loan-docs",
  "settle-booked",
  "settled",
] as const;

/** Short human label for the trigger button, or null for stages with no
 *  milestone email (pre-lodge / lodged / pre-approval). */
export function stageCommsLabel(stageId: StageId): string | null {
  switch (stageId) {
    case "cond-approved":
      return "Conditional approval";
    case "unconditional":
      return "Formal approval";
    case "loan-docs":
      return "Loan documents ready";
    case "settle-booked":
      return "Settlement booked";
    case "settled":
      return "Settled — congratulations";
    default:
      return null;
  }
}

export function hasStageComms(stageId: StageId): boolean {
  return stageCommsLabel(stageId) !== null;
}

/** Strip the "(proposed)" / "(chosen)" bookkeeping suffix so the lender
 *  reads naturally in a customer email; fall back to a neutral phrase
 *  when the lender is still a placeholder. */
function cleanLender(lender: string): string {
  const cleaned = lender
    .replace(/\s*\((proposed|chosen)\)\s*/gi, "")
    .trim();
  if (!cleaned || /^(tbc|tbd|unknown)$/i.test(cleaned)) return "the lender";
  return cleaned;
}

/** The booked settlement date, only when it's a real value (not TBD). */
function settlementDatePhrase(deal: Deal): string {
  const s = (deal.settlement || "").trim();
  if (!s || /^(tbd|tbc|unknown)$/i.test(s)) return "";
  return ` for ${s}`;
}

const SIGN_OFF = (brokerShort: string, brokerPhone: string): string =>
  ["Kind regards,", brokerShort, `Mankin Finance · ${brokerPhone}`].join("\n");

const CLOSING_LINE = "Any questions at all, reply here or give me a call.";

export function composeStageMilestoneEmail(
  stageId: StageId,
  ctx: StageCommsContext,
): ComposedStageEmail | null {
  if (!hasStageComms(stageId)) return null;

  const { deal, brokerShort, brokerPhone } = ctx;
  const first = dealGreetingFirstName(deal);
  const lender = cleanLender(deal.lender);
  const signOff = SIGN_OFF(brokerShort, brokerPhone);

  const wrap = (topic: string, paragraphs: string[]): ComposedStageEmail => ({
    subject: subjectWithMankin(topic, deal),
    body: [`Hi ${first},`, "", ...paragraphs, "", signOff].join("\n"),
  });

  switch (stageId) {
    case "cond-approved":
      return wrap("Conditional approval", [
        `Good news - ${lender} has come back with conditional approval on your loan. That means they are comfortable to proceed, subject to a few standard conditions we will now work through together.`,
        "",
        "Here is what happens next: I will confirm the outstanding conditions and let you know if anything is needed from you. In most cases there is nothing for you to do right now.",
        "",
        CLOSING_LINE,
      ]);

    case "unconditional":
      return wrap("Formal approval", [
        `Great news - your loan is now formally approved with ${lender}. This is the big one: the lender has given the final tick and your finance is secured.`,
        "",
        "Next step: the lender prepares your loan documents. I will be in touch the moment they are ready to sign and will walk you through them.",
        "",
        CLOSING_LINE,
      ]);

    case "loan-docs":
      return wrap("Loan documents", [
        `Your loan documents are ready. ${lender} has issued them, and the next step is getting them signed and returned so we can book your settlement.`,
        "",
        "I will send the documents through with clear instructions on where to sign. Once they are back, we move to locking in your settlement date.",
        "",
        CLOSING_LINE,
      ]);

    case "settle-booked":
      return wrap("Settlement booked", [
        `Your settlement is booked${settlementDatePhrase(deal)}. This is the final step: on settlement day the funds are transferred and the loan is complete.`,
        "",
        "There is nothing you need to do beforehand unless I flag it. I will confirm everything is in order in the lead-up and let you know the moment it settles.",
        "",
        CLOSING_LINE,
      ]);

    case "settled":
      return wrap("Settled", [
        "Congratulations - your loan has settled. Everything is now complete and your finance is fully in place. It has been a genuine pleasure helping you get here.",
        "",
        "We will stay in touch to make sure your loan keeps working for you, and I am always here if anything comes up or your circumstances change.",
        "",
        reviewRequestLine(ctx.reviewUrl),
        "",
        CLOSING_LINE,
      ]);

    default:
      return null;
  }
}

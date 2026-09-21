import { clawbackStatus, type ClawbackStatus } from "./clawback";
import { customerClosingFor } from "./customer-closing";

/**
 * World-class anniversary check-in content.
 *
 * Single source of truth for the email body + broker talking points
 * at each milestone (3, 6, 12, 18, 24 months). Both the CX
 * Anniversaries page (settlements.ts back-book) and the post-settlement
 * cron (deals settled via Mankin) call into this helper so the customer
 * gets the same comprehensive content regardless of which surface
 * triggers the touchpoint.
 *
 * Lender awareness: pass a `lender` + `settlementDate` and the helper
 * uses clawbackStatus() to shape the messaging:
 *   - high (still inside full clawback): never push refinance
 *   - medium (50% clawback): re-pricing only; mention "true" review at
 *     clawback clear
 *   - clear (Resimac/Bluestone after 6mo, or any lender after 18mo):
 *     active refinance positioning is on the table
 *
 * Pure function, no server-only imports — safe in client components.
 */

export type Milestone = 3 | 6 | 12 | 18 | 24;

export interface MilestoneInput {
  /** Customer's first name(s) for the greeting. */
  firstName: string;
  /** Settlement date as ISO yyyy-mm-dd. Drives the clawback status. */
  settlementDate: string;
  /** Lender on the loan. Used for clawback lookup; safe to pass empty. */
  lender: string;
  /** Broker short name for the sign-off. */
  brokerShort: string;
  /** Broker direct number. */
  brokerPhone: string;
  /** TEAM id of the broker. Used to look up their bookingUrl so the
   *  closing line points to the calendar link in the signature.
   *  Optional - omit and the closing falls back to "give me a call". */
  brokerId?: string;
  /** Which milestone we're hitting. */
  milestone: Milestone;
  /** Optional override for `new Date()` — used in tests. */
  asOf?: Date;
}

export interface MilestoneContent {
  /** Bullet list shown on the broker's CX page so they know what
   *  the email will cover and can re-use them in calls. */
  talkingPoints: string[];
  /** Full email body, ready to drop into a mailto: link or Outlook. */
  body: string;
  /** Status badge the broker UI can render: "Clawback clear",
   *  "Inside 50% clawback", "Inside 100% clawback". */
  clawback: ClawbackStatus;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function buildMilestoneContent(input: MilestoneInput): MilestoneContent {
  const cb = clawbackStatus(input.lender, input.settlementDate, input.asOf);
  const tps = talkingPointsFor(input.milestone, cb);
  const body = bodyFor(input, cb);
  return { talkingPoints: tps, body, clawback: cb };
}

/** Just the talking points list. Used by the CX page row when we only
 *  want the bullets, not a full email. */
export function talkingPointsForMilestone(
  milestone: Milestone,
  lender: string,
  settlementDate: string,
  asOf?: Date,
): { points: string[]; clawback: ClawbackStatus } {
  const cb = clawbackStatus(lender, settlementDate, asOf);
  return { points: talkingPointsFor(milestone, cb), clawback: cb };
}

/* -------------------------------------------------------------------------- */
/* Talking points (broker-facing bullets)                                     */
/* -------------------------------------------------------------------------- */

function talkingPointsFor(milestone: Milestone, cb: ClawbackStatus): string[] {
  switch (milestone) {
    case 3:
      return [
        "Direct debit landing on the right day and amount.",
        "If applicable: offset is set up and being used (salary in, expenses out).",
        "Quick desktop valuation through CoreLogic to set a baseline equity number.",
      ];
    case 6:
      return [
        "Direct debit still landing cleanly.",
        "If applicable: offset balance + usage doing what we modelled.",
        "Refresh the desktop valuation. Note any meaningful market movement.",
        "Open question on any life changes (work, family, plans) ahead of the 12mo review.",
      ];
    case 12:
      return [
        "Ask for latest statement to confirm current rate.",
        "Re-pricing request directly to current lender; target a 0.10 to 0.40 ppt drop.",
        "Full market scan across the Mankin panel; line up the better external options.",
        "Fresh desktop valuation. Quantify equity built via repayments + appreciation.",
        cb.tier === "high"
          ? "100% clawback still applies. Lean toward re-pricing existing lender; only recommend moving externally if the saving genuinely outweighs the clawback hit."
          : cb.tier === "medium"
            ? "50% clawback still applies. Be transparent with the customer; only move them if it's clearly the right call."
            : "Clawback clear. Move externally if the spread justifies it.",
      ];
    case 18:
      return [
        "Aggressive re-pricing request to current lender; the rate has almost certainly drifted.",
        "Full market comparison; model 5-year cost of staying vs moving, with refinance costs included.",
        "Fresh desktop valuation. Real equity build is usually visible by 18mo.",
        cb.safeToRefinance
          ? "Clawback clear. Move externally if the lender won't sharpen and the spread is material."
          : `${cb.monthsUntilClear} months until clawback clears. Aggressive re-pricing now; queue the external move for once it's clear.`,
      ];
    case 24:
      return [
        "Lender has almost certainly drifted; re-pricing request first.",
        "If they refuse, run the full market comparison and model 5-year net saving.",
        "Fresh desktop valuation. Two years of repayments + appreciation usually shows meaningful equity.",
        "Equity unlock conversation if the customer is open to it.",
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* Email bodies (customer-facing)                                             */
/* -------------------------------------------------------------------------- */

function bodyFor(input: MilestoneInput, cb: ClawbackStatus): string {
  const { firstName, brokerShort, brokerPhone, brokerId, milestone } = input;
  const phone = brokerPhone || "0420 699 983";
  const closing = customerClosingFor({ brokerId, brokerShort });
  const args = { firstName, brokerShort, brokerPhone: phone, closing, cb };

  switch (milestone) {
    case 3:
      return compose3Month(args);
    case 6:
      return compose6Month(args);
    case 12:
      return compose12Month(args);
    case 18:
      return compose18Month(args);
    case 24:
      return compose24Month(args);
  }
}

interface ComposeArgs {
  firstName: string;
  brokerShort: string;
  brokerPhone: string;
  /** Pre-built closing paragraph - "Hope you've been keeping well..." */
  closing: string;
  cb: ClawbackStatus;
}

function compose3Month(args: ComposeArgs): string {
  /* brokerPhone + cb live in the signature / are not used at 3mo. Body
     stays tight: one greeting line, the two checks, the closing, one
     sign-off. */
  void args.brokerPhone;
  void args.cb;
  const { firstName, brokerShort, closing } = args;
  return `Hi ${firstName},

Quick 3-month check-in.

A couple of things at this stage:
- Direct debits landing cleanly
- If we set you up with an offset, it's being used the way we planned

Anything come up? Otherwise I'll check in again at 6 months.

${closing}

Cheers,
${brokerShort}`;
}

function compose6Month(args: ComposeArgs): string {
  void args.cb;
  void args.brokerPhone;
  const { firstName, brokerShort, closing } = args;

  return `Hi ${firstName},

Halfway through your first year. Quick check-in.

- Direct debits still landing cleanly
- If you've got an offset, balance and usage doing what we planned

Anything changed for you (work, family, plans)? Flick me a note so I can factor it into your 12-month review.

${closing}

Cheers,
${brokerShort}`;
}

function compose12Month(args: ComposeArgs): string {
  void args.cb;
  void args.brokerPhone;
  const { firstName, brokerShort, closing } = args;

  return `Hi ${firstName},

You're one year in. Time for your annual review.

Flick me your latest statement and I'll:
- Ask your lender to sharpen your rate
- Compare across every lender we deal with
- Refresh your property valuation so we can quantify your equity

Reply with two or three windows for a 30-minute call.

${closing}

Cheers,
${brokerShort}`;
}

function compose18Month(args: ComposeArgs): string {
  void args.cb;
  void args.brokerPhone;
  const { firstName, brokerShort, closing } = args;

  return `Hi ${firstName},

It's been 18 months. Time for a proper rate review.

Flick me your latest statement and I'll:
- Push hard on your current lender for a sharper rate
- Run a full market comparison and model 5-year stay vs move
- Refresh your property valuation

If your lender won't budge and the external market is materially sharper, we move you. Your call once you've got the numbers.

Reply with two or three windows for a 30-minute call.

${closing}

Cheers,
${brokerShort}`;
}

function compose24Month(args: ComposeArgs): string {
  void args.cb;
  void args.brokerPhone;
  const { firstName, brokerShort, closing } = args;
  return `Hi ${firstName},

Two years in. Time for another rate check.

Flick me your latest statement and I'll:
- Request a sharper rate from your current lender
- Run a market comparison if they refuse
- Refresh your property valuation

Reply with two or three windows for a 30-minute call.

${closing}

Cheers,
${brokerShort}`;
}

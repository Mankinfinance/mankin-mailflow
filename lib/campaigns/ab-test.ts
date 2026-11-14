/**
 * Subject line A/B testing.
 *
 * Pure module — no database, no clock beyond what is passed in — so the
 * two decisions that matter (who is in the test, and which subject won)
 * are testable without sending anything.
 *
 * The shape of the test: a slice of the audience is split evenly between
 * two subject lines, results are given a few hours to accumulate, and the
 * winner goes to everyone held back. The winner is the one more people
 * clicked, once there are enough clicks to read; otherwise the one more
 * people opened (see MIN_CLICKS_TO_DECIDE). That is the only test worth running
 * at a few hundred recipients. Testing the body as well, or optimising
 * send time per contact, needs volume this firm will not have for a long
 * time, and a result read off too little data is worse than no test —
 * it gets believed.
 */

export type Variant = "a" | "b";

/** Below this, a split leaves each arm too small to read anything into. */
export const MIN_AUDIENCE_FOR_TEST = 40;

export const MIN_TEST_PERCENT = 10;
export const MAX_TEST_PERCENT = 50;

/**
 * How many recipients go into the test, given the audience size.
 *
 * Rounded down to an even number so the two arms are the same size —
 * an 11-person test is 6 against 5, and the arm with the extra
 * recipient wins ties for reasons that have nothing to do with the
 * subject line.
 */
export function testGroupSize(audienceSize: number, percent: number): number {
  if (audienceSize < MIN_AUDIENCE_FOR_TEST) return 0;
  const clamped = Math.min(
    MAX_TEST_PERCENT,
    Math.max(MIN_TEST_PERCENT, Math.round(percent)),
  );
  const raw = Math.floor((audienceSize * clamped) / 100);
  const even = raw - (raw % 2);
  // Never let the test swallow the whole audience: there has to be a
  // holdback for the winner to be worth deciding.
  return Math.min(even, audienceSize - 2);
}

/**
 * Assign variants across the audience.
 *
 * Returns one entry per recipient index: "a", "b", or null for the
 * holdback. Alternating rather than taking the first half for A and the
 * second for B — the audience arrives sorted by source and settlement
 * date, so a contiguous split would put the oldest loans in one arm and
 * the newest in the other, and measure that instead of the subject.
 */
export function assignVariants(
  audienceSize: number,
  percent: number,
): Array<Variant | null> {
  const inTest = testGroupSize(audienceSize, percent);
  return Array.from({ length: audienceSize }, (_, i) =>
    i < inTest ? (i % 2 === 0 ? "a" : "b") : null,
  );
}

export interface VariantResult {
  variant: Variant;
  sent: number;
  opened: number;
  clicked: number;
  /** Null when nothing was sent. */
  clickRate: number | null;
  /** Null when nothing was sent — not zero: an unsent arm has not failed
   *  to be opened. */
  openRate: number | null;
}

export interface AbDecision {
  /** Null while the test should keep running. */
  winner: Variant | null;
  /** Why, in words a broker can act on. */
  reason: string;
  a: VariantResult;
  b: VariantResult;
}

function result(variant: Variant, sent: number, opened: number, clicked: number): VariantResult {
  return {
    variant,
    sent,
    opened,
    clicked,
    openRate: sent === 0 ? null : (opened / sent) * 100,
    clickRate: sent === 0 ? null : (clicked / sent) * 100,
  };
}

/**
 * Clicks needed across both arms before they decide the test.
 *
 * Opens are no longer a clean signal: Apple Mail Privacy Protection
 * fetches every image on delivery, so a large share of "opens" are a
 * proxy, not a person, and they land on both subjects alike. A click is
 * a person. But clicks are rare - a few per hundred - and two or three
 * of them are noise. So clicks decide once there are enough to mean
 * something, and opens decide below that, with the reason saying which.
 */
export const MIN_CLICKS_TO_DECIDE = 10;

/**
 * Call the test, or say why it is not callable yet.
 *
 * Deliberately conservative about declaring a winner:
 *
 * - It will not decide before the window closes, because early opens
 *   skew towards whoever happens to be at their desk.
 * - It will not decide while test emails are still going out, because
 *   an arm that is half-sent has an artificially low open rate.
 * - On a tie it picks A, and says so. A coin toss dressed as a result
 *   is worse than an arbitrary rule stated plainly.
 */
export function decideWinner(input: {
  aSent: number;
  aOpened: number;
  bSent: number;
  bOpened: number;
  aClicked?: number;
  bClicked?: number;
  /** Test recipients still waiting to go out. */
  pendingInTest: number;
  startedAt: Date | null;
  decideAfterHours: number;
  now: Date;
}): AbDecision {
  const a = result("a", input.aSent, input.aOpened, input.aClicked ?? 0);
  const b = result("b", input.bSent, input.bOpened, input.bClicked ?? 0);
  const hold = (reason: string): AbDecision => ({ winner: null, reason, a, b });

  if (input.startedAt === null) return hold("The test has not started.");
  if (input.pendingInTest > 0) {
    return hold(
      `Still sending the test — ${input.pendingInTest} to go before the clock starts.`,
    );
  }

  const elapsedHours =
    (input.now.getTime() - input.startedAt.getTime()) / 3_600_000;
  if (elapsedHours < input.decideAfterHours) {
    const left = Math.ceil(input.decideAfterHours - elapsedHours);
    return hold(`Deciding in about ${left} ${left === 1 ? "hour" : "hours"}.`);
  }

  if (a.openRate === null || b.openRate === null) {
    // Nothing reached one of the arms, so there is nothing to compare.
    // Send the rest rather than holding them hostage to a broken test.
    return {
      winner: "a",
      reason: "One subject never sent, so there was nothing to compare.",
      a,
      b,
    };
  }

  /* Clicks first, when there are enough of them to read. */
  if (
    a.clicked + b.clicked >= MIN_CLICKS_TO_DECIDE &&
    a.clickRate !== null &&
    b.clickRate !== null &&
    a.clickRate !== b.clickRate
  ) {
    const winner = a.clickRate > b.clickRate ? a : b;
    const loser = a.clickRate > b.clickRate ? b : a;
    return {
      winner: winner.variant,
      reason: `Subject ${winner.variant.toUpperCase()} was clicked by ${winner.clickRate!.toFixed(1)}% against ${loser.clickRate!.toFixed(1)}%.`,
      a,
      b,
    };
  }

  if (a.openRate === b.openRate) {
    return {
      winner: "a",
      reason: `Both subjects opened at ${a.openRate.toFixed(1)}%. Tie, so the first one goes out.`,
      a,
      b,
    };
  }

  const winner = a.openRate > b.openRate ? a : b;
  const loser = a.openRate > b.openRate ? b : a;
  return {
    winner: winner.variant,
    reason: `Subject ${winner.variant.toUpperCase()} opened at ${winner.openRate!.toFixed(1)}% against ${loser.openRate!.toFixed(1)}%.`,
    a,
    b,
  };
}

/** The subject a given recipient should receive. */
export function subjectFor(
  campaign: { subject: string; subjectB: string | null; abWinner: string | null },
  variant: string | null,
): string {
  // A test recipient gets the subject they were assigned.
  if (variant === "b" && campaign.subjectB) return campaign.subjectB;
  if (variant === "a") return campaign.subject;
  // The holdback gets the winner, or subject A if it was never decided.
  if (campaign.abWinner === "b" && campaign.subjectB) return campaign.subjectB;
  return campaign.subject;
}

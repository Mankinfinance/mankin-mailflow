import type { CampaignRecipientRow, EmailSuppressionRow } from "@/lib/db/schema";

/**
 * Sending health — the reputation signals we can actually measure.
 *
 * A note on what is missing and why. The recipient-side complaint rate
 * ("this is spam" presses) is the number every deliverability guide
 * leads with, and we do not have it:
 *
 *  - Microsoft SNDS and the Outlook.com JMRP feedback loop are keyed to
 *    the *sending IP*. Mail goes out through Exchange Online's shared
 *    outbound pool, which the firm does not own and cannot register.
 *  - Google Postmaster Tools reports per domain rather than per IP, so
 *    it does apply — but it suppresses low-volume days, and a brokerage
 *    sending a few hundred to Gmail twice a month sits under that line
 *    most of the time.
 *
 * So rather than a complaint rate we cannot see, this module computes
 * the two leading indicators we own outright. On shared infrastructure
 * these are what actually move first: people opting out in numbers, and
 * mail to addresses that no longer exist.
 */

export type HealthBand = "good" | "watch" | "act";

export interface HealthMetric {
  /** Share of the denominator, 0–1. Null when there is nothing to divide. */
  rate: number | null;
  numerator: number;
  denominator: number;
  band: HealthBand;
}

/**
 * Thresholds. These are the widely used industry lines rather than
 * anything derived from this firm's own history — with two sends a
 * month there is not enough data to derive a baseline, and a made-up
 * one would be worse than a conservative standard.
 */
export const UNSUBSCRIBE_WATCH = 0.005; // 0.5%
export const UNSUBSCRIBE_ACT = 0.01; //   1%
export const BOUNCE_WATCH = 0.02; //      2%
export const BOUNCE_ACT = 0.05; //        5%

/** Below this many observations a rate is too noisy to act on. Two
 *  opt-outs from ten sends is 20%, which would scream — and a false
 *  alarm here trains people to ignore the real one. */
const MINIMUM_SAMPLE = 50;

function bandFor(
  rate: number | null,
  watch: number,
  act: number,
  denominator: number,
): HealthBand {
  if (rate === null || denominator < MINIMUM_SAMPLE) return "good";
  if (rate >= act) return "act";
  if (rate >= watch) return "watch";
  return "good";
}

function metric(
  numerator: number,
  denominator: number,
  watch: number,
  act: number,
): HealthMetric {
  const rate = denominator > 0 ? numerator / denominator : null;
  return {
    rate,
    numerator,
    denominator,
    band: bandFor(rate, watch, act, denominator),
  };
}

export interface SendingHealth {
  /** Opt-outs as a share of delivered mail. */
  unsubscribe: HealthMetric;
  /** Hard bounces as a share of attempted sends. */
  bounce: HealthMetric;
  /** Emails delivered in the window — context for the rates above. */
  delivered: number;
  /** The worst band across the metrics, for the headline. */
  overall: HealthBand;
}

export function buildSendingHealth(input: {
  recipients: CampaignRecipientRow[];
  suppressions: EmailSuppressionRow[];
  since: Date;
}): SendingHealth {
  const inWindow = input.recipients.filter(
    (r) => r.sentAt !== null && r.sentAt >= input.since,
  );
  const delivered = inWindow.length;

  const unsubscribes = inWindow.filter(
    (r) => r.unsubscribedAt !== null && r.unsubscribedAt >= input.since,
  ).length;

  /* Bounces are counted off the register rather than the failed
     recipient rows: a bounce arrives after the send, sometimes days
     later, and the register is where reconciliation writes it. */
  const bounces = input.suppressions.filter(
    (s) => s.reason === "bounce" && s.createdAt >= input.since,
  ).length;

  const attempted =
    delivered +
    input.recipients.filter((r) => r.status === "failed" && r.sentAt === null)
      .length;

  const unsubscribe = metric(
    unsubscribes,
    delivered,
    UNSUBSCRIBE_WATCH,
    UNSUBSCRIBE_ACT,
  );
  const bounce = metric(bounces, attempted, BOUNCE_WATCH, BOUNCE_ACT);

  const bands = [unsubscribe.band, bounce.band];
  const overall: HealthBand = bands.includes("act")
    ? "act"
    : bands.includes("watch")
      ? "watch"
      : "good";

  return { unsubscribe, bounce, delivered, overall };
}

/** Plain-language reading of a metric, for the panel. */
export function describeBand(
  band: HealthBand,
  kind: "unsubscribe" | "bounce",
  denominator: number,
): string {
  if (denominator < MINIMUM_SAMPLE) {
    return "Not enough sends yet to read anything into this.";
  }
  if (kind === "unsubscribe") {
    return band === "act"
      ? "High. Look at who the last sends went to before sending again."
      : band === "watch"
        ? "Worth watching. A segment may be too broad."
        : "Normal.";
  }
  return band === "act"
    ? "High. The back-book needs cleaning before the next blast."
    : band === "watch"
      ? "Worth watching. Old addresses are starting to show."
      : "Normal.";
}

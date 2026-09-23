/**
 * Send pacing constants.
 *
 * Kept apart from send.ts, which is server-only: the settings module
 * needs the default batch size and must stay importable from a test and
 * from the client bundle's type graph.
 */

/**
 * Emails per campaign per cron run.
 *
 * Exchange Online's published ceiling is 30 messages a minute per
 * mailbox. The campaign cron ticks every five minutes, so 60 per run
 * is 12 a minute — under half the ceiling, with the rest of the margin
 * left for the broker's own outgoing mail from the same mailbox.
 *
 * This comment previously reasoned from an hourly cron and described
 * 60 as "60 an hour". It is 720 an hour now. Still well inside the
 * per-minute limit, which is the one that throttles, and far below the
 * daily recipient cap at any volume this back-book reaches.
 */
export const BATCH_SIZE = 60;

/**
 * Ceiling across every campaign in one cron run. The route is capped at
 * maxDuration 300s, so this is the number that keeps a run finishing:
 * two full campaigns' worth of sends, with room for each Graph call to
 * be slow, rather than however many campaigns happen to be due.
 */
export const RUN_BUDGET = 120;

/**
 * What a broker's "Send campaign" click dispatches inline, before the
 * cron takes over. Small on purpose — a server action has a much
 * shorter budget than the cron, and its job here is only to show the
 * broker their campaign moving.
 */
export const FIRST_BATCH_SIZE = 10;

/**
 * How long a claimed recipient stays claimed before another run may
 * take it back.
 *
 * A dispatcher that dies mid-batch — the 300s function timeout, a
 * redeploy landing mid-send — leaves rows claimed by nobody. Without a
 * expiry those people are never emailed. With too short an expiry, a
 * slow-but-alive run has its batch taken and they are emailed twice,
 * which is the failure the claim exists to prevent.
 *
 * So: comfortably longer than the longest a run can live (maxDuration
 * is 300s), at the cost of a crashed batch waiting a quarter of an
 * hour. Delay is recoverable; a duplicate to a client is not.
 */
export const CLAIM_TTL_MS = 15 * 60 * 1000;

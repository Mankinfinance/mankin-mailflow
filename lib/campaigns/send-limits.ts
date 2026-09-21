/**
 * Send pacing constants.
 *
 * Kept apart from send.ts, which is server-only: the settings module
 * needs the default batch size and must stay importable from a test and
 * from the client bundle's type graph.
 */

/**
 * Emails per campaign per cron run. Exchange Online's published ceiling
 * is 30 messages a minute per mailbox; 60 an hour leaves a wide margin
 * and still clears a 500-person back-book in a working day.
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

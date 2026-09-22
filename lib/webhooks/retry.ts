/**
 * When to try a failed delivery again, and when to stop.
 *
 * A receiver being down for an hour should not cost the firm an
 * unsubscribe notification — that is the one event another system most
 * needs, and losing it means someone keeps being mailed by the CRM
 * after asking not to be.
 *
 * Six attempts over roughly a day: a minute, five, half an hour, two
 * hours, six, then twelve. Long enough to ride out a deploy or a
 * certificate expiry, short enough that the first few land while
 * somebody is still looking at the screen.
 *
 * Pure module — attempt number in, delay out.
 */

/** Minutes after each failed attempt before trying again. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];

export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/** How long a single delivery may take before it is abandoned. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most of a response body we will read.
 *
 * A receiver that answers with a megabyte of HTML should not be able
 * to spend our memory. Enough to keep an error message worth showing.
 */
export const MAX_RESPONSE_BYTES = 2048;

/**
 * When to try again after `attempt` has failed, or null when that was
 * the last one.
 */
export function nextAttemptAt(attempt: number, now: Date): Date | null {
  if (attempt < 1 || attempt >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[attempt];
  /* Full jitter. Without it, an outage that fails two hundred
     deliveries at once has them all retry in the same second, and the
     receiver comes back up into a thundering herd it then fails
     again. */
  const jittered = minutes * (0.5 + Math.random() * 0.5);
  return new Date(now.getTime() + jittered * 60_000);
}

/**
 * Whether a response means "try again" or "stop".
 *
 * A 4xx is the receiver saying it understood and refused, so repeating
 * it changes nothing — except 408 and 429, which are explicitly "not
 * now". Everything else, including a network failure, is worth
 * another go.
 */
export function shouldRetry(status: number | null): boolean {
  if (status === null) return true; // network failure, timeout, DNS
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

/** Whether a status counts as the receiver having accepted it. */
export function isDelivered(status: number): boolean {
  return status >= 200 && status < 300;
}

/** One line for the delivery log. */
export function describeAttempt(args: {
  attempt: number;
  status: number | null;
  error: string | null;
}): string {
  if (args.status === null) {
    return `Attempt ${args.attempt} — ${args.error ?? "no response"}`;
  }
  return `Attempt ${args.attempt} — HTTP ${args.status}`;
}

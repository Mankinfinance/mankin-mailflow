import vercelConfig from "../../vercel.json";

/**
 * Facts about how this deployment sends, read from the deployment
 * rather than restated.
 *
 * The send pace only means something alongside how often the cron
 * actually fires, and that lives in vercel.json. Hard-coding "hourly"
 * next to the control would have been wrong the moment the schedule
 * moved to daily for the Hobby plan — which is exactly what happened.
 */

interface CronEntry {
  path: string;
  schedule: string;
}

/** The campaign dispatcher's own schedule. */
export const CAMPAIGN_CRON_PATH = "/api/cron/campaigns";

/**
 * How many times a day the campaign cron fires.
 *
 * Only the two shapes this project uses are decoded — a fixed minute
 * every hour, and a fixed time each day. Anything else falls back to
 * once daily, which is the conservative reading: it makes a send look
 * slower than it is rather than promising a speed the schedule cannot
 * deliver.
 */
export function runsPerDayFor(schedule: string): number {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return 1;
  const [, hour] = fields;

  if (hour === "*") return 24;

  const everyN = /^\*\/(\d+)$/.exec(hour);
  if (everyN) {
    const step = Number(everyN[1]);
    return step > 0 ? Math.floor(24 / step) : 1;
  }

  // A comma list of explicit hours: "0,12" is twice a day.
  if (hour.includes(",")) return hour.split(",").filter(Boolean).length;

  return 1;
}

export function scheduledRunsPerDay(): number {
  const crons = (vercelConfig as { crons?: CronEntry[] }).crons ?? [];
  const entry = crons.find((c) => c.path === CAMPAIGN_CRON_PATH);
  return entry ? runsPerDayFor(entry.schedule) : 1;
}

/**
 * The domain campaigns appear to come from.
 *
 * Derived from the sending mailbox rather than configured, because it
 * is not a choice: Graph sends as the broker, so the domain follows the
 * Microsoft 365 tenant. A settings field for it would only be a place
 * to record a wrong answer.
 */
export function senderDomain(email: string | null | undefined): string {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return "mankinfinance.com";
  return email.slice(at + 1).toLowerCase().trim() || "mankinfinance.com";
}

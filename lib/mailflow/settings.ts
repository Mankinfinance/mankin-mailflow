import { z } from "zod";
import { BATCH_SIZE } from "@/lib/campaigns/send-limits";

/**
 * Mailflow's own settings — the handful of things a broker should be
 * able to change without a deploy.
 *
 * Everything here used to live in environment variables. That was fine
 * while only a developer touched it, but the postal address in a
 * campaign footer and the pace a send goes out at are decisions the
 * person running the marketing makes, and asking them to raise a commit
 * for a change of address is how a footer stays wrong for a year.
 *
 * Environment variables remain the fallback, so a deployment that has
 * never opened this screen behaves exactly as it did before. The
 * precedence is: what is stored here, then the env var, then the
 * built-in default.
 *
 * Pure module — the env read happens in `settingsFromEnv`, which the
 * caller passes in, so the merge logic is testable without a process.
 */

export const MIN_BATCH = 10;
export const MAX_BATCH = 120;

export const MailflowSettingsSchema = z.object({
  /**
   * Postal address printed in the campaign footer. The broker signature
   * above it already carries name, phone, email and the credit lines,
   * so this is additional rather than the whole identification.
   *
   * Empty means the line is omitted. An address that is not a real
   * place to write to is worse than no address — the Spam Act wants the
   * sender reachable, not merely described.
   */
  postalAddress: z.string().default(""),

  /**
   * Mailbox added to List-Unsubscribe alongside the one-click URL.
   *
   * Empty by default and deliberately so: an unsubscribe request that
   * lands in an unread mailbox is a breach, whereas a route never
   * offered is not.
   */
  unsubscribeMailto: z.string().default(""),

  /** New campaigns inherit these. Existing ones keep what they had. */
  trackOpensByDefault: z.boolean().default(true),
  trackClicksByDefault: z.boolean().default(true),

  /**
   * Emails per campaign per cron run.
   *
   * Exchange Online's published ceiling is 30 messages a minute per
   * mailbox. The bounds below keep any value a broker can choose well
   * inside it — the setting is for slowing down, not speeding up.
   */
  batchSize: z.number().int().min(MIN_BATCH).max(MAX_BATCH).default(BATCH_SIZE),
});

export type MailflowSettings = z.infer<typeof MailflowSettingsSchema>;

/** The env-var layer, read once by the caller and passed in. */
export interface SettingsEnv {
  postalAddress?: string;
  unsubscribeMailto?: string;
}

/**
 * Stored value, then env var, then built-in default.
 *
 * A stored empty string is a decision — "no postal address" — and must
 * win over an env var that still has one, or clearing the field in the
 * UI would silently do nothing. So the stored layer counts as present
 * whenever the key exists at all, not merely when it is non-empty.
 */
export function resolveSettings(
  stored: unknown,
  env: SettingsEnv = {},
): MailflowSettings {
  const base = MailflowSettingsSchema.parse({});
  const fromEnv: Partial<MailflowSettings> = {};
  if (env.postalAddress?.trim()) fromEnv.postalAddress = env.postalAddress.trim();
  if (env.unsubscribeMailto?.trim()) {
    fromEnv.unsubscribeMailto = env.unsubscribeMailto.trim();
  }

  /* Only the keys the row actually carries. `.partial()` makes fields
     optional but still applies their defaults, so parsing an empty
     object hands back a full set of defaults — which would silently
     overwrite the env layer with values nobody chose. Presence in the
     raw object is the test, which is also what lets a stored empty
     string clear an env var. */
  const raw =
    stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const parsed = MailflowSettingsSchema.partial().safeParse(raw);
  const fromStore: Record<string, unknown> = {};
  if (parsed.success) {
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key in raw) fromStore[key] = value;
    }
  }

  return MailflowSettingsSchema.parse({ ...base, ...fromEnv, ...fromStore });
}

/** Read the env layer. Kept apart so the merge above stays pure. */
export function settingsFromEnv(): SettingsEnv {
  return {
    postalAddress: process.env.CAMPAIGN_POSTAL_ADDRESS,
    unsubscribeMailto: process.env.CAMPAIGN_UNSUBSCRIBE_MAILTO,
  };
}

/**
 * Roughly how long a campaign of this size takes to clear, given the
 * batch size and how often the cron runs.
 *
 * Shown beside the pace control because "60 per run" means nothing on
 * its own — the number a broker cares about is whether the send lands
 * today or on Thursday.
 */
export function estimateSendWindow(
  audienceSize: number,
  batchSize: number,
  runsPerDay: number,
): string {
  if (audienceSize <= 0 || batchSize <= 0) return "—";
  const runs = Math.ceil(audienceSize / batchSize);
  if (runs <= 1) return "One run — goes out in a single pass";

  if (runsPerDay >= 24) {
    const hours = runs;
    if (hours < 24) return `About ${hours} hours`;
    const days = Math.ceil(hours / 24);
    return `About ${days} ${days === 1 ? "day" : "days"}`;
  }

  const days = Math.ceil(runs / Math.max(1, runsPerDay));
  return `About ${days} ${days === 1 ? "day" : "days"}`;
}

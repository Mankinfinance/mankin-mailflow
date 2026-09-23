import { z } from "zod";

/**
 * Shared types for the campaign tool — the bulk marketing sender that
 * mails the back-book and the live pipeline from one written body.
 *
 * Pure module: schemas and literals only, no server imports, so both the
 * pure audience/merge logic and the server-only send path can pull from
 * it, and the tests can exercise it without a database.
 */

/* -------------------------------------------------------------------------- */
/* Audience                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which dataset a contact came from:
 *  - settlements: the YBR commission back-book (settled loans)
 *  - deals: the live pipeline
 */
export const AudienceSourceSchema = z.enum(["settlements", "deals"]);
export type AudienceSource = z.infer<typeof AudienceSourceSchema>;

/**
 * The pipeline deal a contact belongs to, when they came from the
 * pipeline; null for the settled back-book, which has no open deal.
 *
 * One definition, compared against the schema's own enum member rather
 * than a typed-out string. Three places need this answer, and the
 * first one written compared against "deal" when the resolver stores
 * "deals" — so the Salestrekker notes built on it never fired. Renaming
 * the enum member now breaks the build instead of the feature.
 */
export function dealIdForSource(
  sourceKind: string,
  sourceId: string,
): string | null {
  return sourceKind === AudienceSourceSchema.enum.deals ? sourceId : null;
}

export const LoanStatusSchema = z.enum(["active", "closed", "discharged"]);

/**
 * The saved definition of who a campaign goes to. Stored as JSONB on the
 * campaign so a segment can gain fields without a migration, and parsed
 * back through this schema on read — every field has a default, so old
 * rows keep working.
 *
 * The filter is resolved to concrete recipients ONCE, when the broker
 * sends. Re-resolving at send time would mean a campaign written on
 * Monday quietly picks up people who settled on Tuesday.
 */
export const AudienceFilterSchema = z.object({
  /** Datasets to draw from. Empty means nobody. */
  sources: z.array(AudienceSourceSchema).default(["settlements"]),

  /** Restrict to these owning brokers. Empty means every broker. */
  brokerIds: z.array(z.string()).default([]),

  /* ---- Back-book (settlements) filters ---- */

  /** Loan statuses to include. Defaults to active loans only. */
  loanStatus: z.array(LoanStatusSchema).default(["active"]),
  /** Settled on/after this ISO yyyy-mm-dd. */
  settledFrom: z.string().nullable().default(null),
  /** Settled on/before this ISO yyyy-mm-dd. */
  settledTo: z.string().nullable().default(null),
  /** Lender codes to include (e.g. ["ANZ", "CBA"]). Empty means any. */
  lenderCodes: z.array(z.string()).default([]),
  /** Current balance floor / ceiling in whole AUD. */
  minBalance: z.number().nullable().default(null),
  maxBalance: z.number().nullable().default(null),

  /* ---- Pipeline (deals) filters ---- */

  /** Pipeline stages to include. Empty means any stage. */
  stageIds: z.array(z.string()).default([]),
  /** Include deals parked on the nurture list. */
  includeNurtured: z.boolean().default(true),
  /** Drop deals contacted within this many days — avoids marketing at
   *  someone the broker spoke to yesterday. Null disables the check. */
  excludeContactedWithinDays: z.number().nullable().default(null),

  /* ---- Tags (apply across both sources) ---- */

  /**
   * Keep only contacts carrying at least one of these tags. Empty means
   * no tag requirement.
   *
   * Any-of rather than all-of: a broker tagging someone "investor" and
   * "self-employed" is describing them, not building a conjunction, and
   * all-of on two descriptive tags usually resolves to nobody.
   */
  includeTags: z.array(z.string()).default([]),
  /** Drop contacts carrying any of these tags. Wins over includeTags. */
  excludeTags: z.array(z.string()).default([]),

  /* ---- Follow-up ---- */

  /**
   * Narrow to the people who were sent an earlier campaign and never
   * opened it.
   *
   * Stored as the campaign's id rather than a frozen list of addresses,
   * so the audience preview keeps telling the truth: someone who opens
   * the original tomorrow drops out of the follow-up, which is exactly
   * what should happen.
   *
   * Composes with every other clause — a follow-up can still be limited
   * to one broker, or exclude a tag.
   */
  nonOpenersOf: z.string().nullable().default(null),
});

export type AudienceFilter = z.infer<typeof AudienceFilterSchema>;

/** A filter that selects the whole active back-book — the starting point
 *  for a new campaign. */
export function defaultAudienceFilter(): AudienceFilter {
  return AudienceFilterSchema.parse({});
}

/**
 * One resolved contact. `fields` carries the merge values frozen at
 * resolve time so the email a customer receives always matches what the
 * broker previewed, even if the underlying loan changes later.
 */
export interface AudienceMember {
  email: string;
  name: string;
  firstName: string;
  sourceKind: AudienceSource;
  sourceId: string;
  /** Owning broker's team id, or "" when the record has no match. */
  brokerId: string;
  fields: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Campaign status                                                            */
/* -------------------------------------------------------------------------- */

/**
 * draft     — being written, audience not resolved
 * scheduled — recipients resolved, waiting for scheduledFor
 * sending   — the cron is working through the recipient queue
 * sent      — every recipient reached a terminal state
 * paused    — broker stopped it mid-send; the queue is left intact
 * cancelled — abandoned before completion
 */
export const CampaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "sent",
  "paused",
  "cancelled",
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

/** Statuses the cron is allowed to pick work up from. */
export const DISPATCHABLE_STATUSES: CampaignStatus[] = ["scheduled", "sending"];

/** A campaign in one of these states can still be edited. */
export function isEditable(status: CampaignStatus): boolean {
  return status === "draft" || status === "paused";
}

export const RecipientStatusSchema = z.enum([
  "pending",
  "sent",
  "failed",
  "skipped",
]);
export type RecipientStatus = z.infer<typeof RecipientStatusSchema>;

/** Why a resolved recipient never got mailed. */
export type SkipReason = "suppressed" | "no-email" | "duplicate";

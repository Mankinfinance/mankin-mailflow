import "server-only";
import { desc, eq, ne, and, or, gte, lte, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { revalidateDeals } from "../deal-cache";
import {
  activities,
  auditLog,
  dealImports,
  dealNotes,
  deals,
  eodBriefs,
  leaves,
  portalTokens,
  otpAttempts,
  otpCodes,
  chatTranscripts,
  postSettlementCheckIns,
  pipelineSnapshots,
  lenderSlas,
  referrers,
  campaigns,
  campaignRecipients,
  campaignLinkClicks,
  emailSuppressions,
  automations,
  automationRuns,
  automationSends,
  forms,
  formSubmissions,
  landingPages,
  emailTemplates,
  contactTags,
  audienceSegments,
  mailflowSettings,
  mediaFiles,
  SETTINGS_ROW_ID,
  type ActivityRow,
  type AuditLogRow,
  type ChatTranscriptMessage,
  type ChatTranscriptRow,
  type DealNoteRow,
  type DealRow,
  type EodBriefRow,
  type LeaveRow,
  type NewActivity,
  type NewAuditLog,
  type NewChatTranscript,
  type NewDealNote,
  type NewDealRow,
  type NewEodBrief,
  type NewLeave,
  type NewOtpAttempt,
  type NewPortalToken,
  type OtpAttemptRow,
  type PortalTokenRow,
  type PostSettlementCheckInRow,
  type PipelineSnapshotRow,
  type LenderSlaRow,
  type ReferrerRow,
  type NewReferrer,
  type CampaignRow,
  type NewCampaignRow,
  type CampaignRecipientRow,
  type NewCampaignRecipient,
  type EmailSuppressionRow,
  type NewEmailSuppression,
  type CampaignLinkClickRow,
  type AutomationRow,
  type NewAutomationRow,
  type AutomationRunRow,
  type NewAutomationRun,
  type AutomationSendRow,
  type NewAutomationSend,
  type FormRow,
  type NewFormRow,
  type FormSubmissionRow,
  type NewFormSubmission,
  type LandingPageRow,
  type NewLandingPage,
  type EmailTemplateRow,
  type NewEmailTemplate,
  type ContactTagRow,
  type AudienceSegmentRow,
  type MailflowSettingsRow,
  type MediaFileRow,
  type NewMediaFile,
  type NewAudienceSegment,
  surveys,
  surveyResponses,
  type SurveyRow,
  type NewSurveyRow,
  type SurveyResponseRow,
  type NewSurveyResponse,
} from "./schema";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { DealSchema } from "@/lib/clients/salestrekker/types";

/** Parse a deal's stored JSON payload into a typed Deal, applying schema
 *  defaults for fields added since it was written and recomputing
 *  daysSinceContact. Returns null on parse failure so the caller can drop
 *  the bad row without crashing.
 *
 *  Exported because the cached deal-list layer parses AFTER the cache
 *  boundary: Deal carries Date fields (e.g. lastContactAt) that Next's
 *  data-cache serialisation would mangle, so the cache holds JSON-only
 *  payloads and Zod rebuilds the typed Deal — dates and all — here on
 *  each request. Cheap next to the cross-region DB round-trip the cache
 *  saves. */
export function parseDealData(id: string, data: unknown): Deal | null {
  try {
    const deal = DealSchema.parse(data);
    if (deal.lastContactAt) {
      deal.daysSinceContact = Math.max(
        0,
        Math.floor((Date.now() - deal.lastContactAt.getTime()) / 86_400_000),
      );
    }
    return deal;
  } catch (err) {
    console.warn(`[deal repo] failed to parse deal ${id}:`, err);
    return null;
  }
}

/** Parse a full DealRow (convenience wrapper over parseDealData). */
function parseDeal(row: DealRow): Deal | null {
  return parseDealData(row.id, row.data);
}

/** True when the Postgres error indicates a missing table / relation
 *  (Postgres error code 42P01). Hit when MOCK_DB=false but
 *  pnpm db:migrate hasn't run yet. We swallow these in the deal repo
 *  so the dashboard still renders (empty) instead of crashing. */
function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "42P01" || e.cause?.code === "42P01";
}

/** Shared in-memory fallback for deals when the real Postgres `deals`
 *  table is missing. Lets the New Application flow work end-to-end in
 *  Vercel deployments where MOCK_DB=false was set before the migration
 *  ran. Deals written here disappear on cold start / redeploy, so this
 *  is strictly a stopgap — the operator should still run pnpm db:migrate
 *  for real persistence. The console.warn surfaces the situation each
 *  time the fallback fires. */
const fallbackDealStore = new Map<string, Deal>();
let fallbackLastImport: ImportMeta | null = null;
function warnFallback(method: string): void {
  console.warn(
    `[deal repo] \`deals\` table missing — using in-memory fallback for ${method}. Run pnpm db:migrate or set MOCK_DB=true for proper behaviour.`,
  );
}

/**
 * Repository interfaces — what the app calls. Mock + real impls below.
 * Pick one via the MOCK_DB env at module init.
 */

export interface AuditRepo {
  insert(row: NewAuditLog): Promise<AuditLogRow>;
  list(filter?: { dealId?: string; action?: string; limit?: number }): Promise<AuditLogRow[]>;
}

export interface PortalTokenRepo {
  insert(row: NewPortalToken): Promise<PortalTokenRow>;
  findByHash(hash: string): Promise<PortalTokenRow | null>;
  revoke(hash: string, by: string): Promise<void>;
  /** All tokens for a deal, newest first. Used by the expiry badge + nudge cron. */
  listByDeal(dealId: string): Promise<PortalTokenRow[]>;
}

export interface OtpAttemptRepo {
  insert(row: NewOtpAttempt): Promise<void>;
  /** Count attempts (success or fail) for a deal in the last N minutes */
  countRecent(dealId: string, withinMinutes: number): Promise<number>;
}

export interface OtpCodeRepo {
  upsert(args: { dealId: string; method: "sms" | "email"; code: string; expiresAt: Date }): Promise<void>;
  find(dealId: string, method: "sms" | "email"): Promise<{ code: string; expiresAt: Date; attempts: number } | null>;
  incrementAttempts(dealId: string, method: "sms" | "email"): Promise<void>;
  delete(dealId: string, method: "sms" | "email"): Promise<void>;
}

export interface ChatTranscriptRepo {
  upsert(row: NewChatTranscript): Promise<ChatTranscriptRow>;
  listByDeal(dealId: string): Promise<ChatTranscriptRow[]>;
}

export interface ActivityRepo {
  insert(row: NewActivity): Promise<ActivityRow>;
  /** Inclusive of `since`, exclusive of `until`. */
  listBetween(since: Date, until: Date): Promise<ActivityRow[]>;
  listForBroker(brokerId: string, limit?: number): Promise<ActivityRow[]>;
}

export interface LeaveRepo {
  insert(row: NewLeave): Promise<LeaveRow>;
  /** All currently-active leaves at the given moment. */
  listActive(at?: Date): Promise<LeaveRow[]>;
  /** Most recent leaves (active + closed) for the audit log. */
  listRecent(limit?: number): Promise<LeaveRow[]>;
  /** Close an open leave by setting endAt on the given row. */
  endLeave(id: string, endAt: Date): Promise<void>;
}

export interface EodBriefRepo {
  insert(row: NewEodBrief): Promise<EodBriefRow>;
  /** Currently-queued briefs for a broker (default = today's only). */
  listQueuedForBroker(brokerId: string, date?: string): Promise<EodBriefRow[]>;
  /** Has a brief already been generated for this deal on this date? */
  findForDealOnDate(dealId: string, date: string): Promise<EodBriefRow | null>;
  markSent(id: string, sentAt: Date): Promise<void>;
  markDismissed(id: string, dismissedAt: Date): Promise<void>;
}

export interface PostSettlementCheckInRepo {
  /** Idempotent upsert keyed on (dealId, kind). Used by the page on
   *  every render to ensure a row exists for every (settled deal, kind)
   *  pair without duplicates. */
  upsertPending(args: {
    dealId: string;
    kind: string;
    dueAt: Date;
    assignedTo: string | null;
  }): Promise<PostSettlementCheckInRow>;

  /** Bulk idempotent create: ensures a pending row exists for every
   *  supplied (dealId, kind) pair, inserting only the missing ones. One
   *  SELECT + one INSERT total, replacing the per-pair upsertPending
   *  loop the page ran on every render. Existing rows are untouched. */
  ensurePending(
    entries: Array<{
      dealId: string;
      kind: string;
      dueAt: Date;
      assignedTo: string | null;
    }>,
  ): Promise<void>;

  /** List all check-ins for the page (filters out dismissed by default). */
  list(args: {
    includeDismissed?: boolean;
  }): Promise<PostSettlementCheckInRow[]>;

  /** Find a specific row by primary key. Used by action handlers. */
  findById(id: string): Promise<PostSettlementCheckInRow | null>;

  /** Lifecycle transitions. Each updates updatedAt automatically. */
  markSent(id: string, sentAt: Date): Promise<void>;
  markDismissed(id: string, dismissedAt: Date, dismissedBy: string): Promise<void>;
  snooze(id: string, snoozedUntil: Date): Promise<void>;
  assign(id: string, assignedTo: string | null): Promise<void>;
  setDraft(
    id: string,
    draft: { subject: string; body: string; source: "template" | "anthropic" },
  ): Promise<void>;

  /** Rows due for cron pre-drafting: status=pending AND dueAt in the next N days. */
  listForPreDrafting(within: { days: number; asOf?: Date }): Promise<PostSettlementCheckInRow[]>;

  /** Rows that have come off snooze (snoozedUntil <= now). Moved back to
   *  pending by the cron. */
  listExpiredSnoozes(asOf?: Date): Promise<PostSettlementCheckInRow[]>;
}

/**
 * Persistent deal store. Replaces the in-memory imported-deals Map so
 * deals created via "+ New application" and uploads via /dashboard/import
 * survive deploys and cold starts.
 */
export interface ImportMeta {
  importedAt: string;
  importedBy: string;
  filename: string;
  rowCount: number;
}

export interface DealRepo {
  /** Return every deal in the store, newest first by updated_at. */
  list(): Promise<Deal[]>;
  /** Return every deal's stored JSON payload (JSON-safe — no Date
   *  objects), newest first. Feeds the cross-request cached deal-list
   *  layer, which must cache pre-parse data for lossless serialisation;
   *  callers parse each payload with parseDealData. */
  listRaw(): Promise<Array<{ id: string; data: unknown }>>;
  /** Find one by id. */
  get(id: string): Promise<Deal | null>;
  /** Upsert a single deal. Bumps updated_at. */
  upsert(deal: Deal): Promise<void>;
  /** Atomic replace: clear all rows then insert these. Used by the
   *  Excel import REPLACE semantics. */
  replaceAll(deals: Deal[]): Promise<number>;
  /** Add one deal. Equivalent to upsert but named for the create flow. */
  add(deal: Deal): Promise<void>;
  /** Remove one. */
  remove(id: string): Promise<void>;
  /** Wipe everything. */
  clear(): Promise<void>;
  /** Count rows. */
  count(): Promise<number>;
  /** Record an import session. */
  recordImport(args: {
    importedBy: string;
    filename: string;
    rowCount: number;
  }): Promise<void>;
  /** Most recent import meta, or null. */
  lastImport(): Promise<ImportMeta | null>;
}

export interface DealNoteRepo {
  add(row: NewDealNote): Promise<DealNoteRow>;
  listByDeal(dealId: string): Promise<DealNoteRow[]>;
}

export interface ReferrerRepo {
  add(row: NewReferrer): Promise<ReferrerRow>;
  list(filter?: { createdBy?: string; isActive?: boolean }): Promise<ReferrerRow[]>;
  findById(id: string): Promise<ReferrerRow | null>;
  findByTokenHash(hash: string): Promise<ReferrerRow | null>;
  deactivate(id: string): Promise<void>;
  reissueToken(id: string, tokenHash: string, expiresAt: Date): Promise<void>;
  incrementLeadsCount(id: string): Promise<void>;
  updateLastAccessed(id: string): Promise<void>;
}

export interface PipelineSnapshotRepo {
  /** Idempotent upsert of a day's counts, keyed on snapshot_date. */
  record(args: {
    snapshotDate: string;
    counts: Record<string, number>;
  }): Promise<void>;
  /** The most recent snapshot on or before `date` (YYYY-MM-DD), or null.
   *  Used to fetch the "~7 days ago" baseline for the overview's
   *  week-on-week column, tolerating any missed days. */
  onOrBefore(date: string): Promise<PipelineSnapshotRow | null>;
}

export interface LenderSlaRepo {
  /** Every stored SLA row (one per lender that has values set). */
  all(): Promise<LenderSlaRow[]>;
  /** Insert or update a lender's turnaround days. */
  upsert(row: {
    lenderId: string;
    purchaseAssessDays: number | null;
    refinanceAssessDays: number | null;
    preApprovalDays: number | null;
    formalDays: number | null;
    updatedBy: string;
  }): Promise<void>;
}

/** Roll-up of a campaign's recipient states, for the results panel. */
export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
}

export interface CampaignRepo {
  create(row: NewCampaignRow): Promise<CampaignRow>;
  update(id: string, patch: Partial<NewCampaignRow>): Promise<void>;
  get(id: string): Promise<CampaignRow | null>;
  list(filter?: { statuses?: string[] }): Promise<CampaignRow[]>;
  remove(id: string): Promise<void>;

  /** Campaigns the cron should work on: sending, or scheduled and due. */
  dueForDispatch(now: Date): Promise<CampaignRow[]>;

  /** Replace the resolved recipient list. Returns how many rows landed —
   *  lower than the input when two source records share an address. */
  setRecipients(
    campaignId: string,
    rows: NewCampaignRecipient[],
  ): Promise<number>;
  listRecipients(
    campaignId: string,
    filter?: { statuses?: string[]; limit?: number },
  ): Promise<CampaignRecipientRow[]>;
  /** The next slice of unsent recipients, oldest first. */
  nextPending(campaignId: string, limit: number): Promise<CampaignRecipientRow[]>;
  /** Move an A/B holdback to pending once a winner is known. */
  releaseHoldback(campaignId: string): Promise<number>;
  updateRecipient(
    id: string,
    patch: Partial<NewCampaignRecipient>,
  ): Promise<void>;
  findRecipient(
    campaignId: string,
    email: string,
  ): Promise<CampaignRecipientRow | null>;
  stats(campaignId: string): Promise<CampaignStats>;
  /** Count one click on one URL. Idempotent upsert on (campaign, url). */
  recordLinkClick(campaignId: string, url: string): Promise<void>;
  /** Per-URL click totals, most-clicked first. */
  linkClicks(campaignId: string): Promise<CampaignLinkClickRow[]>;
  /**
   * Every click timestamp across every campaign, for the send-time
   * model. One narrow column rather than whole recipient rows, because
   * the editor asks this on every load and the answer is a histogram —
   * pulling 5,000 rows per campaign to read one field each would make
   * opening a draft proportional to the firm's entire sending history.
   */
  clickTimestamps(limit?: number): Promise<Date[]>;

  /* ---- suppression list (the do-not-market register) ---- */
  suppress(row: NewEmailSuppression): Promise<void>;
  unsuppress(email: string): Promise<void>;
  listSuppressions(limit?: number): Promise<EmailSuppressionRow[]>;
  /** Which of these addresses are suppressed. Batched so the sender can
   *  check a whole campaign in one query. */
  suppressedAmong(emails: string[]): Promise<Set<string>>;
}

/** Per-node counts for the automation canvas. */
export interface AutomationNodeStats {
  nodeId: string;
  sent: number;
  opened: number;
  clicked: number;
  dropped: number;
}

export interface AutomationRepo {
  create(row: NewAutomationRow): Promise<AutomationRow>;
  update(id: string, patch: Partial<NewAutomationRow>): Promise<void>;
  get(id: string): Promise<AutomationRow | null>;
  list(filter?: { statuses?: string[] }): Promise<AutomationRow[]>;
  remove(id: string): Promise<void>;

  /* ---- runs ---- */
  /** Enrol a contact. Returns null when they are already in this one. */
  startRun(row: NewAutomationRun): Promise<AutomationRunRow | null>;
  updateRun(id: string, patch: Partial<NewAutomationRun>): Promise<void>;
  /** Runs whose wait has expired, oldest first. */
  dueRuns(now: Date, limit: number): Promise<AutomationRunRow[]>;
  listRuns(
    automationId: string,
    filter?: { statuses?: string[]; limit?: number },
  ): Promise<AutomationRunRow[]>;
  /** Addresses already enrolled, so nobody enters twice. */
  enrolledEmails(automationId: string): Promise<Set<string>>;

  /* ---- sends ---- */
  recordSend(row: NewAutomationSend): Promise<AutomationSendRow>;
  /** The most recent send for a run — what a condition judges. */
  latestSendForRun(runId: string): Promise<AutomationSendRow | null>;
  findSend(
    automationId: string,
    email: string,
  ): Promise<AutomationSendRow | null>;
  updateSend(id: string, patch: Partial<NewAutomationSend>): Promise<void>;
  /** Per-node totals for the canvas. */
  nodeStats(automationId: string): Promise<AutomationNodeStats[]>;
}

export interface FormRepo {
  create(row: NewFormRow): Promise<FormRow>;
  update(id: string, patch: Partial<NewFormRow>): Promise<void>;
  get(id: string): Promise<FormRow | null>;
  list(filter?: { types?: string[]; statuses?: string[] }): Promise<FormRow[]>;
  remove(id: string): Promise<void>;
  /** Count one impression. Fire-and-forget from the public endpoint. */
  recordView(id: string): Promise<void>;

  addSubmission(row: NewFormSubmission): Promise<FormSubmissionRow>;
  updateSubmission(
    id: string,
    patch: Partial<NewFormSubmission>,
  ): Promise<void>;
  listSubmissions(
    formId: string,
    limit?: number,
  ): Promise<FormSubmissionRow[]>;
  /** Submission counts per form, for the list. */
  submissionCounts(): Promise<Record<string, number>>;
  /**
   * Submission counts per landing page, for the pages list.
   *
   * Keyed on the page an enquiry actually came through rather than on
   * the form it used, so a form embedded on three pages reports three
   * separate conversion figures instead of the same total three times.
   * Submissions with no page (the hosted form, the embed) are excluded.
   */
  pageSubmissionCounts(): Promise<Record<string, number>>;
}

export interface LandingPageRepo {
  create(row: NewLandingPage): Promise<LandingPageRow>;
  update(id: string, patch: Partial<NewLandingPage>): Promise<void>;
  get(id: string): Promise<LandingPageRow | null>;
  /** Look a page up by its public slug — the routing path. */
  bySlug(slug: string): Promise<LandingPageRow | null>;
  list(): Promise<LandingPageRow[]>;
  remove(id: string): Promise<void>;
  recordView(id: string): Promise<void>;
}

export interface EmailTemplateRepo {
  create(row: NewEmailTemplate): Promise<EmailTemplateRow>;
  update(id: string, patch: Partial<NewEmailTemplate>): Promise<void>;
  get(id: string): Promise<EmailTemplateRow | null>;
  list(): Promise<EmailTemplateRow[]>;
  remove(id: string): Promise<void>;
  /** Count a use, so the gallery can lead with what the firm reaches for. */
  recordUse(id: string): Promise<void>;
}

export interface ContactTagRepo {
  /** Every tag row, for building the email -> tags map. */
  list(): Promise<ContactTagRow[]>;
  /** Distinct tags with how many contacts carry each. */
  counts(): Promise<Array<{ tag: string; count: number }>>;
  /** Idempotent — re-adding an existing tag is a no-op. */
  add(emails: string[], tag: string, addedBy: string): Promise<number>;
  remove(emails: string[], tag: string): Promise<number>;
  /** Drop a label everywhere it appears. */
  removeTagEntirely(tag: string): Promise<void>;
}

export interface AudienceSegmentRepo {
  create(row: NewAudienceSegment): Promise<AudienceSegmentRow>;
  update(id: string, patch: Partial<NewAudienceSegment>): Promise<void>;
  get(id: string): Promise<AudienceSegmentRow | null>;
  list(): Promise<AudienceSegmentRow[]>;
  remove(id: string): Promise<void>;
}

export interface MailflowSettingsRepo {
  /** The stored payload, or null when nobody has saved any yet. */
  get(): Promise<MailflowSettingsRow | null>;
  save(settings: unknown, updatedBy: string): Promise<void>;
}

/** A file without its bytes — what a listing needs. */
export type MediaFileSummary = Omit<MediaFileRow, "data">;

export interface MediaFileRepo {
  /**
   * Every file, newest first, WITHOUT the payload.
   *
   * The bytes are deliberately absent: a gallery of twenty 2 MB images
   * would otherwise pull 40 MB into a server render to show twenty
   * thumbnails. Only the serve route reads `data`, one row at a time.
   */
  list(): Promise<MediaFileSummary[]>;
  /** One file with its bytes. Used only by the public serve route. */
  get(id: string): Promise<MediaFileRow | null>;
  create(row: NewMediaFile): Promise<MediaFileSummary>;
  update(id: string, patch: { altText?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  /** Total bytes stored, for the "you are using X" line. */
  totalBytes(): Promise<number>;
}

export interface SurveyRepo {
  create(row: NewSurveyRow): Promise<SurveyRow>;
  get(id: string): Promise<SurveyRow | null>;
  list(filter?: { statuses?: string[] }): Promise<SurveyRow[]>;
  update(id: string, patch: Partial<NewSurveyRow>): Promise<void>;
  remove(id: string): Promise<void>;
  /** Bumped per invitation sent, for the response rate. */
  countSent(id: string, by: number): Promise<void>;

  /**
   * Record a response. Replaces any earlier one from the same address:
   * somebody who answers twice has changed their mind, not doubled
   * their opinion.
   */
  saveResponse(row: NewSurveyResponse): Promise<void>;
  listResponses(
    surveyId: string,
    limit?: number,
  ): Promise<SurveyResponseRow[]>;
  /** Whether this address has already answered, for the response page. */
  findResponse(
    surveyId: string,
    email: string,
  ): Promise<SurveyResponseRow | null>;
  /** Response counts per survey, for the list. */
  responseCounts(): Promise<Record<string, number>>;
}

export interface RepoBundle {
  audit: AuditRepo;
  portalTokens: PortalTokenRepo;
  otp: OtpAttemptRepo;
  otpCode: OtpCodeRepo;
  chat: ChatTranscriptRepo;
  activity: ActivityRepo;
  leave: LeaveRepo;
  eodBrief: EodBriefRepo;
  deal: DealRepo;
  postSettlement: PostSettlementCheckInRepo;
  pipelineSnapshot: PipelineSnapshotRepo;
  lenderSla: LenderSlaRepo;
  dealNotes: DealNoteRepo;
  referrer: ReferrerRepo;
  campaign: CampaignRepo;
  automation: AutomationRepo;
  form: FormRepo;
  landingPage: LandingPageRepo;
  emailTemplate: EmailTemplateRepo;
  contactTag: ContactTagRepo;
  segment: AudienceSegmentRepo;
  settings: MailflowSettingsRepo;
  media: MediaFileRepo;
  survey: SurveyRepo;
}

/** Zeroed stats, used when the campaign tables aren't there yet. */
function emptyCampaignStats(): CampaignStats {
  return {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
  };
}

/**
 * Create the campaign tables inline when drizzle/0012 hasn't been applied.
 * Mirrors the migration exactly (including the RLS statements, since these
 * tables hold customer contact details and must stay off the Supabase Data
 * API). Same rescue hatch the referrers table has.
 */
async function ensureCampaignTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "subject" text DEFAULT '' NOT NULL,
    "body" text DEFAULT '' NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "audience" jsonb NOT NULL,
    "from_broker_id" text NOT NULL,
    "created_by" text NOT NULL,
    "scheduled_for" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "track_opens" boolean DEFAULT true NOT NULL,
    "track_clicks" boolean DEFAULT true NOT NULL
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "campaign_recipients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "campaign_id" uuid NOT NULL,
    "email" text NOT NULL,
    "name" text DEFAULT '' NOT NULL,
    "first_name" text DEFAULT '' NOT NULL,
    "source_kind" text NOT NULL,
    "source_id" text NOT NULL,
    "fields" jsonb,
    "status" text DEFAULT 'pending' NOT NULL,
    "skip_reason" text,
    "error" text,
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "campaign_link_clicks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "campaign_id" uuid NOT NULL,
    "url" text NOT NULL,
    "clicks" integer DEFAULT 0 NOT NULL,
    "first_click_at" timestamp with time zone DEFAULT now() NOT NULL
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaign_link_clicks_campaign_idx" ON "campaign_link_clicks" ("campaign_id")`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "campaign_link_clicks_campaign_url_idx" ON "campaign_link_clicks" ("campaign_id","url")`,
  );
  await db.execute(
    sql`ALTER TABLE "campaign_link_clicks" ENABLE ROW LEVEL SECURITY`,
  );
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "email_suppressions" (
    "email" text PRIMARY KEY NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "reason" text DEFAULT 'unsubscribe' NOT NULL,
    "campaign_id" uuid,
    "added_by" text DEFAULT 'customer' NOT NULL
  )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns" ("status")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaigns_scheduled_for_idx" ON "campaigns" ("scheduled_for")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaigns_created_by_idx" ON "campaigns" ("created_by")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_idx" ON "campaign_recipients" ("campaign_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "campaign_recipients_status_idx" ON "campaign_recipients" ("status")`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_campaign_email_idx" ON "campaign_recipients" ("campaign_id","email")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "email_suppressions_created_at_idx" ON "email_suppressions" ("created_at")`,
  );
  await db.execute(sql`ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY`);
  await db.execute(
    sql`ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY`,
  );
  await db.execute(
    sql`ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY`,
  );
}

/**
 * Create the automation tables inline when drizzle/0014 hasn't been
 * applied. Same rescue hatch as ensureCampaignTables, including the RLS
 * statements — runs and sends hold customer contact details.
 */
async function ensureAutomationTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "automations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "flow" jsonb NOT NULL,
    "from_broker_id" text NOT NULL,
    "created_by" text NOT NULL,
    "activated_at" timestamp with time zone,
    "track_opens" boolean DEFAULT true NOT NULL,
    "track_clicks" boolean DEFAULT true NOT NULL
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "automation_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "automation_id" uuid NOT NULL,
    "email" text NOT NULL,
    "name" text DEFAULT '' NOT NULL,
    "source_kind" text NOT NULL,
    "source_id" text NOT NULL,
    "fields" jsonb,
    "status" text DEFAULT 'waiting' NOT NULL,
    "current_node_id" text NOT NULL,
    "next_run_at" timestamp with time zone,
    "entered_at" timestamp with time zone DEFAULT now() NOT NULL,
    "finished_at" timestamp with time zone,
    "error" text
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "automation_sends" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "run_id" uuid NOT NULL,
    "automation_id" uuid NOT NULL,
    "node_id" text NOT NULL,
    "email" text NOT NULL,
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "error" text
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automations_status_idx" ON "automations" ("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automations_created_by_idx" ON "automations" ("created_by")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_runs_automation_idx" ON "automation_runs" ("automation_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_runs_due_idx" ON "automation_runs" ("status","next_run_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "automation_runs_automation_email_idx" ON "automation_runs" ("automation_id","email")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_sends_run_idx" ON "automation_sends" ("run_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_sends_automation_node_idx" ON "automation_sends" ("automation_id","node_id")`);
  await db.execute(sql`ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE "automation_sends" ENABLE ROW LEVEL SECURITY`);
}

/** Create the form tables inline when drizzle/0015 hasn't been applied. */
async function ensureFormTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "forms" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "type" text NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "config" jsonb NOT NULL,
    "created_by" text NOT NULL,
    "views" integer DEFAULT 0 NOT NULL
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "form_submissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "form_id" uuid NOT NULL,
    "page_id" uuid,
    "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text DEFAULT '' NOT NULL,
    "email" text DEFAULT '' NOT NULL,
    "phone" text DEFAULT '' NOT NULL,
    "answers" jsonb,
    "deal_id" text,
    "error" text,
    "ip_address" text,
    "user_agent" text
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "forms_status_idx" ON "forms" ("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "forms_type_idx" ON "forms" ("type")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "form_submissions_form_idx" ON "form_submissions" ("form_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "form_submissions_page_idx" ON "form_submissions" ("page_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "form_submissions_submitted_at_idx" ON "form_submissions" ("submitted_at")`);
  await db.execute(sql`ALTER TABLE "forms" ENABLE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE "form_submissions" ENABLE ROW LEVEL SECURITY`);
}

/** Create the landing page table when drizzle/0016 hasn't been applied. */
async function ensureLandingPageTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "landing_pages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "config" jsonb NOT NULL,
    "created_by" text NOT NULL,
    "published_at" timestamp with time zone,
    "views" integer DEFAULT 0 NOT NULL
  )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "landing_pages_slug_idx" ON "landing_pages" ("slug")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "landing_pages_status_idx" ON "landing_pages" ("status")`);
  await db.execute(sql`ALTER TABLE "landing_pages" ENABLE ROW LEVEL SECURITY`);
}

/** Create the template table when drizzle/0018 hasn't been applied. */
async function ensureEmailTemplateTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "email_templates" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "config" jsonb NOT NULL,
    "created_by" text NOT NULL,
    "times_used" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_templates_created_at_idx" ON "email_templates" ("created_at")`);
  await db.execute(sql`ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY`);
}

/** Create the tag table when drizzle/0019 hasn't been applied. */
async function ensureContactTagTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "contact_tags" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "email" text NOT NULL,
    "tag" text NOT NULL,
    "added_by" text NOT NULL
  )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "contact_tags_email_tag_idx" ON "contact_tags" ("email","tag")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "contact_tags_tag_idx" ON "contact_tags" ("tag")`);
  await db.execute(sql`ALTER TABLE "contact_tags" ENABLE ROW LEVEL SECURITY`);
}

/** Create the segment table when drizzle/0020 hasn't been applied. */
async function ensureSegmentTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "audience_segments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "filter" jsonb NOT NULL,
    "created_by" text NOT NULL
  )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "audience_segments_name_idx" ON "audience_segments" ("name")`);
  await db.execute(sql`ALTER TABLE "audience_segments" ENABLE ROW LEVEL SECURITY`);
}

/** Create the settings table when drizzle/0022 hasn't been applied. */
async function ensureSettingsTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "mailflow_settings" (
    "id" text PRIMARY KEY NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "settings" jsonb NOT NULL,
    "updated_by" text NOT NULL
  )`);
  await db.execute(sql`ALTER TABLE "mailflow_settings" ENABLE ROW LEVEL SECURITY`);
}

/** Create the media table when drizzle/0023 hasn't been applied. */
async function ensureMediaTables(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "media_files" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "name" text NOT NULL,
    "content_type" text NOT NULL,
    "size" integer NOT NULL,
    "data" text NOT NULL,
    "alt_text" text DEFAULT '' NOT NULL,
    "uploaded_by" text NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "media_files_created_at_idx" ON "media_files" ("created_at")`);
  await db.execute(sql`ALTER TABLE "media_files" ENABLE ROW LEVEL SECURITY`);
}

/* -------------------------------------------------------------------------- */
/* Real (Drizzle / Postgres) implementations                                  */
/* -------------------------------------------------------------------------- */

function realRepos(): RepoBundle {
  return {
    audit: {
      async insert(row) {
        const db = getDb();
        const [inserted] = await db.insert(auditLog).values(row).returning();
        return inserted;
      },
      async list(filter = {}) {
        const db = getDb();
        const where = [
          filter.dealId ? eq(auditLog.dealId, filter.dealId) : null,
          filter.action ? eq(auditLog.action, filter.action) : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null);

        const query = db
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt))
          .limit(filter.limit ?? 200);
        return where.length > 0 ? query.where(and(...where)) : query;
      },
    },
    portalTokens: {
      async insert(row) {
        const db = getDb();
        const [inserted] = await db.insert(portalTokens).values(row).returning();
        return inserted;
      },
      async findByHash(hash) {
        const db = getDb();
        const rows = await db.select().from(portalTokens).where(eq(portalTokens.tokenHash, hash)).limit(1);
        return rows[0] ?? null;
      },
      async revoke(hash, by) {
        const db = getDb();
        await db
          .update(portalTokens)
          .set({ revokedAt: new Date(), revokedBy: by })
          .where(eq(portalTokens.tokenHash, hash));
      },
      async listByDeal(dealId) {
        const db = getDb();
        return db
          .select()
          .from(portalTokens)
          .where(eq(portalTokens.dealId, dealId))
          .orderBy(desc(portalTokens.issuedAt));
      },
    },
    otp: {
      async insert(row) {
        const db = getDb();
        await db.insert(otpAttempts).values(row);
      },
      async countRecent(dealId, withinMinutes) {
        const db = getDb();
        const since = new Date(Date.now() - withinMinutes * 60_000);
        const rows = await db
          .select({ id: otpAttempts.id })
          .from(otpAttempts)
          .where(and(eq(otpAttempts.dealId, dealId), gte(otpAttempts.createdAt, since)));
        return rows.length;
      },
    },
    otpCode: {
      async upsert({ dealId, method, code, expiresAt }) {
        const db = getDb();
        const doInsert = () =>
          db
            .insert(otpCodes)
            .values({ dealId, method, code, expiresAt, attempts: 0 })
            .onConflictDoUpdate({
              target: [otpCodes.dealId, otpCodes.method],
              set: { code, expiresAt, attempts: 0 },
            });
        try {
          await doInsert();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          // Table not yet created — run the DDL inline then retry once.
          await db.execute(
            sql`CREATE TABLE IF NOT EXISTS "otp_codes" (
              "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
              "deal_id" text NOT NULL,
              "method" text NOT NULL,
              "code" text NOT NULL,
              "expires_at" timestamp with time zone NOT NULL,
              "attempts" integer DEFAULT 0 NOT NULL,
              "created_at" timestamp with time zone DEFAULT now() NOT NULL
            )`,
          );
          await db.execute(
            sql`CREATE UNIQUE INDEX IF NOT EXISTS "otp_codes_deal_method_uidx"
                ON "otp_codes" ("deal_id", "method")`,
          );
          console.log("[otp] auto-created otp_codes table");
          await doInsert();
        }
      },
      async find(dealId, method) {
        const db = getDb();
        try {
          const rows = await db
            .select({
              code: otpCodes.code,
              expiresAt: otpCodes.expiresAt,
              attempts: otpCodes.attempts,
            })
            .from(otpCodes)
            .where(and(eq(otpCodes.dealId, dealId), eq(otpCodes.method, method)))
            .limit(1);
          return rows[0] ?? null;
        } catch (err) {
          if (isMissingRelation(err)) return null;
          throw err;
        }
      },
      async incrementAttempts(dealId, method) {
        const db = getDb();
        try {
          await db
            .update(otpCodes)
            .set({ attempts: sql`${otpCodes.attempts} + 1` })
            .where(and(eq(otpCodes.dealId, dealId), eq(otpCodes.method, method)));
        } catch (err) {
          if (isMissingRelation(err)) return;
          throw err;
        }
      },
      async delete(dealId, method) {
        const db = getDb();
        try {
          await db
            .delete(otpCodes)
            .where(and(eq(otpCodes.dealId, dealId), eq(otpCodes.method, method)));
        } catch (err) {
          if (isMissingRelation(err)) return;
          throw err;
        }
      },
    },
    chat: {
      async upsert(row) {
        const db = getDb();
        const [inserted] = await db.insert(chatTranscripts).values(row).returning();
        return inserted;
      },
      async listByDeal(dealId) {
        const db = getDb();
        return db
          .select()
          .from(chatTranscripts)
          .where(eq(chatTranscripts.dealId, dealId))
          .orderBy(desc(chatTranscripts.startedAt));
      },
    },
    activity: {
      async insert(row) {
        const db = getDb();
        const [inserted] = await db.insert(activities).values(row).returning();
        return inserted;
      },
      async listBetween(since, until) {
        const db = getDb();
        return db
          .select()
          .from(activities)
          .where(and(gte(activities.createdAt, since), lte(activities.createdAt, until)))
          .orderBy(desc(activities.createdAt));
      },
      async listForBroker(brokerId, limit = 50) {
        const db = getDb();
        return db
          .select()
          .from(activities)
          .where(eq(activities.brokerId, brokerId))
          .orderBy(desc(activities.createdAt))
          .limit(limit);
      },
    },
    leave: {
      async insert(row) {
        const db = getDb();
        const [inserted] = await db.insert(leaves).values(row).returning();
        return inserted;
      },
      async listActive(at = new Date()) {
        const db = getDb();
        // Active = startAt <= now AND (endAt is null OR endAt >= now),
        // expressed in SQL so the start_at index is usable and only
        // active rows come back over the wire.
        return db
          .select()
          .from(leaves)
          .where(
            and(
              lte(leaves.startAt, at),
              or(isNull(leaves.endAt), gte(leaves.endAt, at)),
            ),
          )
          .orderBy(desc(leaves.startAt));
      },
      async listRecent(limit = 50) {
        const db = getDb();
        return db
          .select()
          .from(leaves)
          .orderBy(desc(leaves.startAt))
          .limit(limit);
      },
      async endLeave(id, endAt) {
        const db = getDb();
        await db.update(leaves).set({ endAt }).where(eq(leaves.id, id));
      },
    },
    eodBrief: {
      async insert(row) {
        const db = getDb();
        const [inserted] = await db.insert(eodBriefs).values(row).returning();
        return inserted;
      },
      async listQueuedForBroker(brokerId, date) {
        const db = getDb();
        const whereParts = [
          eq(eodBriefs.brokerId, brokerId),
          eq(eodBriefs.status, "queued"),
        ];
        if (date) whereParts.push(eq(eodBriefs.generationDate, date));
        return db
          .select()
          .from(eodBriefs)
          .where(and(...whereParts))
          .orderBy(desc(eodBriefs.createdAt));
      },
      async findForDealOnDate(dealId, date) {
        const db = getDb();
        const rows = await db
          .select()
          .from(eodBriefs)
          .where(and(eq(eodBriefs.dealId, dealId), eq(eodBriefs.generationDate, date)))
          .limit(1);
        return rows[0] ?? null;
      },
      async markSent(id, sentAt) {
        const db = getDb();
        await db
          .update(eodBriefs)
          .set({ status: "sent", sentAt })
          .where(eq(eodBriefs.id, id));
      },
      async markDismissed(id, dismissedAt) {
        const db = getDb();
        await db
          .update(eodBriefs)
          .set({ status: "dismissed", dismissedAt })
          .where(eq(eodBriefs.id, id));
      },
    },
    deal: {
      async list() {
        try {
          const db = getDb();
          const rows = await db
            .select()
            .from(deals)
            .orderBy(desc(deals.updatedAt));
          return rows
            .map((r) => parseDeal(r))
            .filter((d): d is Deal => d !== null);
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("list");
            return [...fallbackDealStore.values()];
          }
          throw err;
        }
      },
      async listRaw() {
        try {
          const db = getDb();
          const rows = await db
            .select({ id: deals.id, data: deals.data })
            .from(deals)
            .orderBy(desc(deals.updatedAt));
          // row.data is the raw jsonb payload — already JSON-safe.
          return rows.map((r) => ({ id: r.id, data: r.data as unknown }));
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("listRaw");
            // fallbackDealStore holds live Deal objects with Date fields;
            // round-trip through JSON so the cached payload is Date-free
            // (Zod rebuilds the dates on parse, matching the jsonb path).
            return [...fallbackDealStore.values()].map((d) => ({
              id: d.id,
              data: JSON.parse(JSON.stringify(d)) as unknown,
            }));
          }
          throw err;
        }
      },
      async get(id) {
        try {
          const db = getDb();
          const rows = await db
            .select()
            .from(deals)
            .where(eq(deals.id, id))
            .limit(1);
          return rows[0] ? parseDeal(rows[0]) : null;
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("get");
            return fallbackDealStore.get(id) ?? null;
          }
          throw err;
        }
      },
      async upsert(deal) {
        try {
          const db = getDb();
          await db
            .insert(deals)
            .values({
              id: deal.id,
              brokerId: deal.brokerId,
              data: deal,
            })
            .onConflictDoUpdate({
              target: deals.id,
              set: {
                brokerId: deal.brokerId,
                data: deal,
                updatedAt: new Date(),
              },
            });
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("upsert");
            fallbackDealStore.set(deal.id, deal);
          } else {
            throw err;
          }
        }
        revalidateDeals();
      },
      async add(deal) {
        try {
          const db = getDb();
          await db
            .insert(deals)
            .values({
              id: deal.id,
              brokerId: deal.brokerId,
              data: deal,
            })
            .onConflictDoUpdate({
              target: deals.id,
              set: { data: deal, updatedAt: new Date() },
            });
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("add");
            fallbackDealStore.set(deal.id, deal);
          } else {
            throw err;
          }
        }
        revalidateDeals();
      },
      async replaceAll(newDeals) {
        try {
          const db = getDb();
          await db.delete(deals);
          if (newDeals.length > 0) {
            await db.insert(deals).values(
              newDeals.map(
                (d): NewDealRow => ({
                  id: d.id,
                  brokerId: d.brokerId,
                  data: d,
                }),
              ),
            );
          }
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("replaceAll");
            fallbackDealStore.clear();
            for (const d of newDeals) fallbackDealStore.set(d.id, d);
          } else {
            throw err;
          }
        }
        revalidateDeals();
        return newDeals.length;
      },
      async remove(id) {
        try {
          const db = getDb();
          await db.delete(deals).where(eq(deals.id, id));
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("remove");
            fallbackDealStore.delete(id);
          } else {
            throw err;
          }
        }
        revalidateDeals();
      },
      async clear() {
        try {
          const db = getDb();
          await db.delete(deals);
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("clear");
            fallbackDealStore.clear();
            fallbackLastImport = null;
          } else {
            throw err;
          }
        }
        revalidateDeals();
      },
      async count() {
        try {
          const db = getDb();
          const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(deals);
          return row?.n ?? 0;
        } catch (err) {
          if (isMissingRelation(err)) {
            return fallbackDealStore.size;
          }
          throw err;
        }
      },
      async recordImport({ importedBy, filename, rowCount }) {
        try {
          const db = getDb();
          await db.insert(dealImports).values({ importedBy, filename, rowCount });
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("recordImport");
            fallbackLastImport = {
              importedAt: new Date().toISOString(),
              importedBy,
              filename,
              rowCount,
            };
            return;
          }
          throw err;
        }
      },
      async lastImport() {
        try {
          const db = getDb();
          const rows = await db
            .select()
            .from(dealImports)
            .orderBy(desc(dealImports.importedAt))
            .limit(1);
          const row = rows[0];
          return row
            ? {
                importedAt: row.importedAt.toISOString(),
                importedBy: row.importedBy,
                filename: row.filename,
                rowCount: row.rowCount,
              }
            : null;
        } catch (err) {
          if (isMissingRelation(err)) {
            return fallbackLastImport;
          }
          throw err;
        }
      },
    },
    postSettlement: {
      async upsertPending({ dealId, kind, dueAt, assignedTo }) {
        const db = getDb();
        // Check for existing first (Drizzle doesn't have a clean
        // ON CONFLICT helper that returns the row in all branches).
        const existing = await db
          .select()
          .from(postSettlementCheckIns)
          .where(
            and(
              eq(postSettlementCheckIns.dealId, dealId),
              eq(postSettlementCheckIns.kind, kind),
            ),
          )
          .limit(1);
        if (existing[0]) return existing[0];

        const [inserted] = await db
          .insert(postSettlementCheckIns)
          .values({
            dealId,
            kind,
            dueAt,
            assignedTo: assignedTo ?? null,
          })
          .returning();
        return inserted;
      },
      async ensurePending(entries) {
        if (entries.length === 0) return;
        const db = getDb();
        const dealIds = [...new Set(entries.map((e) => e.dealId))];
        // One query for every existing (dealId, kind) among these deals,
        // then insert only the pairs that don't already have a row.
        const existing = await db
          .select({
            dealId: postSettlementCheckIns.dealId,
            kind: postSettlementCheckIns.kind,
          })
          .from(postSettlementCheckIns)
          .where(inArray(postSettlementCheckIns.dealId, dealIds));
        const seen = new Set(existing.map((r) => `${r.dealId}::${r.kind}`));
        const toInsert = entries.filter(
          (e) => !seen.has(`${e.dealId}::${e.kind}`),
        );
        if (toInsert.length === 0) return;
        await db.insert(postSettlementCheckIns).values(
          toInsert.map((e) => ({
            dealId: e.dealId,
            kind: e.kind,
            dueAt: e.dueAt,
            assignedTo: e.assignedTo ?? null,
          })),
        );
      },
      async list({ includeDismissed = false }) {
        const db = getDb();
        // Dismissed rows filtered in SQL (the status index covers it)
        // rather than pulling every row and dropping them in JS.
        return db
          .select()
          .from(postSettlementCheckIns)
          .where(
            includeDismissed
              ? undefined
              : ne(postSettlementCheckIns.status, "dismissed"),
          )
          .orderBy(postSettlementCheckIns.dueAt);
      },
      async findById(id) {
        const db = getDb();
        const rows = await db
          .select()
          .from(postSettlementCheckIns)
          .where(eq(postSettlementCheckIns.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async markSent(id, sentAt) {
        const db = getDb();
        await db
          .update(postSettlementCheckIns)
          .set({ status: "sent", sentAt, updatedAt: new Date() })
          .where(eq(postSettlementCheckIns.id, id));
      },
      async markDismissed(id, dismissedAt, dismissedBy) {
        const db = getDb();
        await db
          .update(postSettlementCheckIns)
          .set({ status: "dismissed", dismissedAt, dismissedBy, updatedAt: new Date() })
          .where(eq(postSettlementCheckIns.id, id));
      },
      async snooze(id, snoozedUntil) {
        const db = getDb();
        await db
          .update(postSettlementCheckIns)
          .set({ status: "snoozed", snoozedUntil, updatedAt: new Date() })
          .where(eq(postSettlementCheckIns.id, id));
      },
      async assign(id, assignedTo) {
        const db = getDb();
        await db
          .update(postSettlementCheckIns)
          .set({ assignedTo, updatedAt: new Date() })
          .where(eq(postSettlementCheckIns.id, id));
      },
      async setDraft(id, draft) {
        const db = getDb();
        await db
          .update(postSettlementCheckIns)
          .set({
            draftSubject: draft.subject,
            draftBody: draft.body,
            draftSource: draft.source,
            updatedAt: new Date(),
          })
          .where(eq(postSettlementCheckIns.id, id));
      },
      async listForPreDrafting({ days, asOf }) {
        const db = getDb();
        const now = asOf ?? new Date();
        const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        return db
          .select()
          .from(postSettlementCheckIns)
          .where(
            and(
              eq(postSettlementCheckIns.status, "pending"),
              lte(postSettlementCheckIns.dueAt, horizon),
            ),
          );
      },
      async listExpiredSnoozes(asOf) {
        const db = getDb();
        const now = asOf ?? new Date();
        // snoozedUntil <= now in SQL. NULL snoozedUntil yields NULL (not
        // true), so those rows are excluded — same as the old
        // `r.snoozedUntil && r.snoozedUntil <= now` JS guard.
        return db
          .select()
          .from(postSettlementCheckIns)
          .where(
            and(
              eq(postSettlementCheckIns.status, "snoozed"),
              lte(postSettlementCheckIns.snoozedUntil, now),
            ),
          );
      },
    },
    pipelineSnapshot: {
      async record({ snapshotDate, counts }) {
        try {
          const db = getDb();
          await db
            .insert(pipelineSnapshots)
            .values({ snapshotDate, counts })
            .onConflictDoUpdate({
              target: pipelineSnapshots.snapshotDate,
              set: { counts, createdAt: new Date() },
            });
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("pipelineSnapshot.record");
            return;
          }
          throw err;
        }
      },
      async onOrBefore(date) {
        try {
          const db = getDb();
          const rows = await db
            .select()
            .from(pipelineSnapshots)
            .where(lte(pipelineSnapshots.snapshotDate, date))
            .orderBy(desc(pipelineSnapshots.snapshotDate))
            .limit(1);
          return rows[0] ?? null;
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("pipelineSnapshot.onOrBefore");
            return null;
          }
          throw err;
        }
      },
    },
    lenderSla: {
      async all() {
        try {
          const db = getDb();
          return await db.select().from(lenderSlas);
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("lenderSla.all");
            return [];
          }
          throw err;
        }
      },
      async upsert({ lenderId, purchaseAssessDays, refinanceAssessDays, preApprovalDays, formalDays, updatedBy }) {
        try {
          const db = getDb();
          await db
            .insert(lenderSlas)
            .values({ lenderId, purchaseAssessDays, refinanceAssessDays, preApprovalDays, formalDays, updatedBy })
            .onConflictDoUpdate({
              target: lenderSlas.lenderId,
              set: { purchaseAssessDays, refinanceAssessDays, preApprovalDays, formalDays, updatedBy, updatedAt: new Date() },
            });
        } catch (err) {
          if (isMissingRelation(err)) {
            warnFallback("lenderSla.upsert");
            return;
          }
          throw err;
        }
      },
    },
    dealNotes: {
      async add(row) {
        const db = getDb();
        const doInsert = () => db.insert(dealNotes).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await db.execute(sql`CREATE TABLE IF NOT EXISTS "deal_notes" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL,
            "deal_id" text NOT NULL,
            "body" text NOT NULL,
            "stamped_body" text NOT NULL,
            "template_id" text,
            "created_by" text NOT NULL
          )`);
          await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "deal_notes_deal_id_idx" ON "deal_notes" ("deal_id")`,
          );
          console.log("[deal_notes] auto-created deal_notes table");
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async listByDeal(dealId) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(dealNotes)
            .where(eq(dealNotes.dealId, dealId))
            .orderBy(desc(dealNotes.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
    },
    referrer: {
      async add(row) {
        const db = getDb();
        const doInsert = () => db.insert(referrers).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          // The referrers table (drizzle/0007) hasn't been applied to this
          // database yet — create it inline then retry once, mirroring the
          // otpCode repo. Keeps "Generate portal link" working even when the
          // migration was missed. The list/find methods already tolerate the
          // missing table by returning empty.
          await db.execute(sql`CREATE TABLE IF NOT EXISTS "referrers" (
            "id" text PRIMARY KEY NOT NULL,
            "name" text NOT NULL,
            "email" text NOT NULL,
            "phone" text DEFAULT '' NOT NULL,
            "company" text DEFAULT '' NOT NULL,
            "type" text DEFAULT 'other' NOT NULL,
            "token_hash" text NOT NULL,
            "expires_at" timestamp with time zone NOT NULL,
            "last_accessed_at" timestamp with time zone,
            "leads_count" integer DEFAULT 0 NOT NULL,
            "is_active" boolean DEFAULT true NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL,
            "created_by" text NOT NULL
          )`);
          await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "referrers_token_hash_idx" ON "referrers" ("token_hash")`,
          );
          await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "referrers_created_by_idx" ON "referrers" ("created_by")`,
          );
          await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "referrers_is_active_idx" ON "referrers" ("is_active")`,
          );
          console.log("[referrer] auto-created referrers table");
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async list(filter = {}) {
        const db = getDb();
        try {
          // createdBy / isActive pushed into SQL (both are indexed) so we
          // don't pull the whole table and filter in JS.
          const conditions = [];
          if (filter.createdBy !== undefined) {
            conditions.push(eq(referrers.createdBy, filter.createdBy));
          }
          if (filter.isActive !== undefined) {
            conditions.push(eq(referrers.isActive, filter.isActive));
          }
          return await db
            .select()
            .from(referrers)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(referrers.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async findById(id) {
        const db = getDb();
        try {
          const [row] = await db.select().from(referrers).where(eq(referrers.id, id)).limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async findByTokenHash(hash) {
        const db = getDb();
        try {
          const [row] = await db.select().from(referrers).where(eq(referrers.tokenHash, hash)).limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async deactivate(id) {
        const db = getDb();
        await db.update(referrers).set({ isActive: false }).where(eq(referrers.id, id));
      },
      async reissueToken(id, tokenHash, expiresAt) {
        const db = getDb();
        await db.update(referrers).set({ tokenHash, expiresAt, isActive: true }).where(eq(referrers.id, id));
      },
      async incrementLeadsCount(id) {
        const db = getDb();
        await db.update(referrers).set({ leadsCount: sql`${referrers.leadsCount} + 1` }).where(eq(referrers.id, id));
      },
      async updateLastAccessed(id) {
        const db = getDb();
        await db.update(referrers).set({ lastAccessedAt: new Date() }).where(eq(referrers.id, id));
      },
    },
    campaign: {
      async create(row) {
        const db = getDb();
        const doInsert = () => db.insert(campaigns).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          // drizzle/0012 hasn't been applied to this database yet. Create
          // the three campaign tables inline and retry once, same as the
          // referrer + deal_notes repos — a missed migration shouldn't
          // take the feature down on a deploy that already has the code.
          await ensureCampaignTables(db);
          console.log("[campaign] auto-created campaign tables");
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        await db
          .update(campaigns)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(campaigns.id, id));
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(campaigns)
            .where(eq(campaigns.id, id))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list(filter = {}) {
        const db = getDb();
        try {
          const where = filter.statuses?.length
            ? inArray(campaigns.status, filter.statuses)
            : undefined;
          return await db
            .select()
            .from(campaigns)
            .where(where)
            .orderBy(desc(campaigns.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db
            .delete(campaignRecipients)
            .where(eq(campaignRecipients.campaignId, id));
          await db.delete(campaigns).where(eq(campaigns.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async dueForDispatch(now) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(campaigns)
            .where(
              or(
                eq(campaigns.status, "sending"),
                and(
                  eq(campaigns.status, "scheduled"),
                  lte(campaigns.scheduledFor, now),
                ),
              ),
            )
            .orderBy(campaigns.scheduledFor);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async setRecipients(campaignId, rows) {
        const db = getDb();
        const write = async () => {
          await db
            .delete(campaignRecipients)
            .where(eq(campaignRecipients.campaignId, campaignId));
          if (rows.length === 0) return 0;
          // onConflictDoNothing covers the (campaign, email) unique index:
          // the audience resolver already dedupes, this is the backstop
          // that keeps a double-click from mailing anyone twice.
          const inserted = await db
            .insert(campaignRecipients)
            .values(rows)
            .onConflictDoNothing()
            .returning({ id: campaignRecipients.id });
          return inserted.length;
        };
        try {
          return await write();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureCampaignTables(db);
          return await write();
        }
      },
      async listRecipients(campaignId, filter = {}) {
        const db = getDb();
        try {
          const conditions = [eq(campaignRecipients.campaignId, campaignId)];
          if (filter.statuses?.length) {
            conditions.push(inArray(campaignRecipients.status, filter.statuses));
          }
          return await db
            .select()
            .from(campaignRecipients)
            .where(and(...conditions))
            .orderBy(campaignRecipients.email)
            .limit(filter.limit ?? 1000);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async clickTimestamps(limit = 20000) {
        const db = getDb();
        try {
          const rows = await db
            .select({ clickedAt: campaignRecipients.clickedAt })
            .from(campaignRecipients)
            .where(isNotNull(campaignRecipients.clickedAt))
            .limit(limit);
          return rows.flatMap((r) => (r.clickedAt ? [r.clickedAt] : []));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async nextPending(campaignId, limit) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(campaignRecipients)
            .where(
              and(
                eq(campaignRecipients.campaignId, campaignId),
                eq(campaignRecipients.status, "pending"),
              ),
            )
            .orderBy(campaignRecipients.email)
            .limit(limit);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async releaseHoldback(campaignId) {
        const db = getDb();
        try {
          const released = await db
            .update(campaignRecipients)
            .set({ status: "pending" })
            .where(
              and(
                eq(campaignRecipients.campaignId, campaignId),
                eq(campaignRecipients.status, "holdback"),
              ),
            )
            .returning();
          return released.length;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return 0;
        }
      },
      async updateRecipient(id, patch) {
        const db = getDb();
        try {
          await db
            .update(campaignRecipients)
            .set(patch)
            .where(eq(campaignRecipients.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async findRecipient(campaignId, email) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(campaignRecipients)
            .where(
              and(
                eq(campaignRecipients.campaignId, campaignId),
                eq(campaignRecipients.email, email.toLowerCase()),
              ),
            )
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async stats(campaignId) {
        const db = getDb();
        try {
          const [row] = await db
            .select({
              total: sql<number>`count(*)::int`,
              pending: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'pending')::int`,
              sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')::int`,
              failed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'failed')::int`,
              skipped: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'skipped')::int`,
              opened: sql<number>`count(*) filter (where ${campaignRecipients.openedAt} is not null)::int`,
              clicked: sql<number>`count(*) filter (where ${campaignRecipients.clickedAt} is not null)::int`,
              unsubscribed: sql<number>`count(*) filter (where ${campaignRecipients.unsubscribedAt} is not null)::int`,
            })
            .from(campaignRecipients)
            .where(eq(campaignRecipients.campaignId, campaignId));
          return row ?? emptyCampaignStats();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return emptyCampaignStats();
        }
      },
      async recordLinkClick(campaignId, url) {
        const db = getDb();
        const bump = () =>
          db
            .insert(campaignLinkClicks)
            .values({ campaignId, url, clicks: 1 })
            .onConflictDoUpdate({
              target: [campaignLinkClicks.campaignId, campaignLinkClicks.url],
              set: { clicks: sql`${campaignLinkClicks.clicks} + 1` },
            });
        try {
          await bump();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureCampaignTables(db);
          await bump();
        }
      },
      async linkClicks(campaignId) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(campaignLinkClicks)
            .where(eq(campaignLinkClicks.campaignId, campaignId))
            .orderBy(desc(campaignLinkClicks.clicks));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async suppress(row) {
        const db = getDb();
        const email = row.email.toLowerCase();
        const doInsert = () =>
          db
            .insert(emailSuppressions)
            .values({ ...row, email })
            // Keep the first opt-out: the original date is the one that
            // matters if we ever have to show when we honoured it.
            .onConflictDoNothing();
        try {
          await doInsert();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureCampaignTables(db);
          await doInsert();
        }
      },
      async unsuppress(email) {
        const db = getDb();
        try {
          await db
            .delete(emailSuppressions)
            .where(eq(emailSuppressions.email, email.toLowerCase()));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async listSuppressions(limit = 500) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(emailSuppressions)
            .orderBy(desc(emailSuppressions.createdAt))
            .limit(limit);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async suppressedAmong(emails) {
        if (emails.length === 0) return new Set<string>();
        const db = getDb();
        const lowered = emails.map((e) => e.toLowerCase());
        try {
          const rows = await db
            .select({ email: emailSuppressions.email })
            .from(emailSuppressions)
            .where(inArray(emailSuppressions.email, lowered));
          return new Set(rows.map((r) => r.email));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return new Set<string>();
        }
      },
    },
    automation: {
      async create(row) {
        const db = getDb();
        const doInsert = () => db.insert(automations).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureAutomationTables(db);
          console.log("[automation] auto-created automation tables");
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        await db
          .update(automations)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(automations.id, id));
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list(filter = {}) {
        const db = getDb();
        try {
          const where = filter.statuses?.length
            ? inArray(automations.status, filter.statuses)
            : undefined;
          return await db
            .select()
            .from(automations)
            .where(where)
            .orderBy(desc(automations.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(automationSends).where(eq(automationSends.automationId, id));
          await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
          await db.delete(automations).where(eq(automations.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async startRun(row) {
        const db = getDb();
        const doInsert = () =>
          db
            .insert(automationRuns)
            .values({ ...row, email: row.email.toLowerCase() })
            // The unique index is what guarantees one entry per person;
            // this turns a double-enrol into a no-op rather than a crash.
            .onConflictDoNothing()
            .returning();
        try {
          const [inserted] = await doInsert();
          return inserted ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureAutomationTables(db);
          const [inserted] = await doInsert();
          return inserted ?? null;
        }
      },
      async updateRun(id, patch) {
        const db = getDb();
        try {
          await db.update(automationRuns).set(patch).where(eq(automationRuns.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async dueRuns(now, limit) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(automationRuns)
            .where(
              and(
                eq(automationRuns.status, "waiting"),
                lte(automationRuns.nextRunAt, now),
              ),
            )
            .orderBy(automationRuns.nextRunAt)
            .limit(limit);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async listRuns(automationId, filter = {}) {
        const db = getDb();
        try {
          const conditions = [eq(automationRuns.automationId, automationId)];
          if (filter.statuses?.length) {
            conditions.push(inArray(automationRuns.status, filter.statuses));
          }
          return await db
            .select()
            .from(automationRuns)
            .where(and(...conditions))
            .orderBy(desc(automationRuns.enteredAt))
            .limit(filter.limit ?? 1000);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async enrolledEmails(automationId) {
        const db = getDb();
        try {
          const rows = await db
            .select({ email: automationRuns.email })
            .from(automationRuns)
            .where(eq(automationRuns.automationId, automationId));
          return new Set(rows.map((r) => r.email));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return new Set<string>();
        }
      },
      async recordSend(row) {
        const db = getDb();
        const doInsert = () =>
          db
            .insert(automationSends)
            .values({ ...row, email: row.email.toLowerCase() })
            .returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureAutomationTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async latestSendForRun(runId) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(automationSends)
            .where(eq(automationSends.runId, runId))
            .orderBy(desc(automationSends.sentAt))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async findSend(automationId, email) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(automationSends)
            .where(
              and(
                eq(automationSends.automationId, automationId),
                eq(automationSends.email, email.toLowerCase()),
              ),
            )
            .orderBy(desc(automationSends.sentAt))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async updateSend(id, patch) {
        const db = getDb();
        try {
          await db.update(automationSends).set(patch).where(eq(automationSends.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async nodeStats(automationId) {
        const db = getDb();
        try {
          return await db
            .select({
              nodeId: automationSends.nodeId,
              sent: sql<number>`count(*) filter (where ${automationSends.sentAt} is not null)::int`,
              opened: sql<number>`count(*) filter (where ${automationSends.openedAt} is not null)::int`,
              clicked: sql<number>`count(*) filter (where ${automationSends.clickedAt} is not null)::int`,
              dropped: sql<number>`count(*) filter (where ${automationSends.error} is not null)::int`,
            })
            .from(automationSends)
            .where(eq(automationSends.automationId, automationId))
            .groupBy(automationSends.nodeId);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
    },
    form: {
      async create(row) {
        const db = getDb();
        const doInsert = () => db.insert(forms).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureFormTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        await db
          .update(forms)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(forms.id, id));
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db.select().from(forms).where(eq(forms.id, id)).limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list(filter = {}) {
        const db = getDb();
        try {
          const conditions = [];
          if (filter.types?.length) conditions.push(inArray(forms.type, filter.types));
          if (filter.statuses?.length) {
            conditions.push(inArray(forms.status, filter.statuses));
          }
          return await db
            .select()
            .from(forms)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(forms.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(formSubmissions).where(eq(formSubmissions.formId, id));
          await db.delete(forms).where(eq(forms.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async recordView(id) {
        const db = getDb();
        try {
          await db
            .update(forms)
            .set({ views: sql`${forms.views} + 1` })
            .where(eq(forms.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async addSubmission(row) {
        const db = getDb();
        const doInsert = () => db.insert(formSubmissions).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureFormTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async updateSubmission(id, patch) {
        const db = getDb();
        try {
          await db.update(formSubmissions).set(patch).where(eq(formSubmissions.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async listSubmissions(formId, limit = 200) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(formSubmissions)
            .where(eq(formSubmissions.formId, formId))
            .orderBy(desc(formSubmissions.submittedAt))
            .limit(limit);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async submissionCounts() {
        const db = getDb();
        try {
          const rows = await db
            .select({
              formId: formSubmissions.formId,
              count: sql<number>`count(*)::int`,
            })
            .from(formSubmissions)
            .groupBy(formSubmissions.formId);
          return Object.fromEntries(rows.map((r) => [r.formId, r.count]));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return {};
        }
      },
      async pageSubmissionCounts() {
        const db = getDb();
        try {
          const rows = await db
            .select({
              pageId: formSubmissions.pageId,
              count: sql<number>`count(*)::int`,
            })
            .from(formSubmissions)
            .where(isNotNull(formSubmissions.pageId))
            .groupBy(formSubmissions.pageId);
          return Object.fromEntries(
            rows.flatMap((r) => (r.pageId ? [[r.pageId, r.count]] : [])),
          );
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return {};
        }
      },
    },
    landingPage: {
      async create(row) {
        const db = getDb();
        const doInsert = () => db.insert(landingPages).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureLandingPageTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        await db
          .update(landingPages)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(landingPages.id, id));
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db.select().from(landingPages).where(eq(landingPages.id, id)).limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async bySlug(slug) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(landingPages)
            .where(eq(landingPages.slug, slug))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list() {
        const db = getDb();
        try {
          return await db.select().from(landingPages).orderBy(desc(landingPages.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(landingPages).where(eq(landingPages.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async recordView(id) {
        const db = getDb();
        try {
          await db
            .update(landingPages)
            .set({ views: sql`${landingPages.views} + 1` })
            .where(eq(landingPages.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
    },
    emailTemplate: {
      async create(row) {
        const db = getDb();
        const doInsert = () => db.insert(emailTemplates).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureEmailTemplateTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        try {
          await db
            .update(emailTemplates)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(emailTemplates.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(emailTemplates)
            .where(eq(emailTemplates.id, id))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list() {
        const db = getDb();
        try {
          return await db
            .select()
            .from(emailTemplates)
            .orderBy(desc(emailTemplates.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async recordUse(id) {
        const db = getDb();
        try {
          await db
            .update(emailTemplates)
            .set({
              timesUsed: sql`${emailTemplates.timesUsed} + 1`,
              lastUsedAt: new Date(),
            })
            .where(eq(emailTemplates.id, id));
        } catch (err) {
          // Counting must never break starting a campaign.
          if (!isMissingRelation(err)) throw err;
        }
      },
    },
    contactTag: {
      async list() {
        const db = getDb();
        try {
          return await db.select().from(contactTags);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async counts() {
        const db = getDb();
        try {
          const rows = await db
            .select({ tag: contactTags.tag, count: sql<number>`count(*)::int` })
            .from(contactTags)
            .groupBy(contactTags.tag)
            .orderBy(contactTags.tag);
          return rows;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async add(emails, tag, addedBy) {
        if (emails.length === 0) return 0;
        const db = getDb();
        const rows = emails.map((email) => ({ email, tag, addedBy }));
        const doInsert = () =>
          db.insert(contactTags).values(rows).onConflictDoNothing().returning();
        try {
          return (await doInsert()).length;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureContactTagTables(db);
          return (await doInsert()).length;
        }
      },
      async remove(emails, tag) {
        if (emails.length === 0) return 0;
        const db = getDb();
        try {
          const removed = await db
            .delete(contactTags)
            .where(
              and(inArray(contactTags.email, emails), eq(contactTags.tag, tag)),
            )
            .returning();
          return removed.length;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return 0;
        }
      },
      async removeTagEntirely(tag) {
        const db = getDb();
        try {
          await db.delete(contactTags).where(eq(contactTags.tag, tag));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
    },
    segment: {
      async create(row) {
        const db = getDb();
        const doInsert = () =>
          db.insert(audienceSegments).values(row).returning();
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureSegmentTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        try {
          await db
            .update(audienceSegments)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(audienceSegments.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(audienceSegments)
            .where(eq(audienceSegments.id, id))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list() {
        const db = getDb();
        try {
          return await db
            .select()
            .from(audienceSegments)
            .orderBy(audienceSegments.name);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(audienceSegments).where(eq(audienceSegments.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
    },
    settings: {
      async get() {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(mailflowSettings)
            .where(eq(mailflowSettings.id, SETTINGS_ROW_ID))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async save(settings, updatedBy) {
        const db = getDb();
        const row = {
          id: SETTINGS_ROW_ID,
          settings,
          updatedBy,
          updatedAt: new Date(),
        };
        const doUpsert = () =>
          db
            .insert(mailflowSettings)
            .values(row)
            .onConflictDoUpdate({
              target: mailflowSettings.id,
              set: { settings, updatedBy, updatedAt: new Date() },
            });
        try {
          await doUpsert();
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureSettingsTables(db);
          await doUpsert();
        }
      },
    },
    survey: {
      async create(row) {
        const db = getDb();
        const [created] = await db.insert(surveys).values(row).returning();
        return created;
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(surveys)
            .where(eq(surveys.id, id))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async list(filter = {}) {
        const db = getDb();
        try {
          const where = filter.statuses?.length
            ? inArray(surveys.status, filter.statuses)
            : undefined;
          return await db
            .select()
            .from(surveys)
            .where(where)
            .orderBy(desc(surveys.updatedAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async update(id, patch) {
        const db = getDb();
        await db
          .update(surveys)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(surveys.id, id));
      },
      async remove(id) {
        const db = getDb();
        await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, id));
        await db.delete(surveys).where(eq(surveys.id, id));
      },
      async countSent(id, by) {
        const db = getDb();
        await db
          .update(surveys)
          .set({ sent: sql`${surveys.sent} + ${by}` })
          .where(eq(surveys.id, id));
      },
      async saveResponse(row) {
        const db = getDb();
        await db
          .insert(surveyResponses)
          .values({ ...row, email: row.email.toLowerCase() })
          .onConflictDoUpdate({
            target: [surveyResponses.surveyId, surveyResponses.email],
            set: {
              answers: row.answers,
              submittedAt: row.submittedAt ?? new Date(),
            },
          });
      },
      async listResponses(surveyId, limit = 2000) {
        const db = getDb();
        try {
          return await db
            .select()
            .from(surveyResponses)
            .where(eq(surveyResponses.surveyId, surveyId))
            .orderBy(desc(surveyResponses.submittedAt))
            .limit(limit);
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async findResponse(surveyId, email) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(surveyResponses)
            .where(
              and(
                eq(surveyResponses.surveyId, surveyId),
                eq(surveyResponses.email, email.toLowerCase()),
              ),
            )
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async responseCounts() {
        const db = getDb();
        try {
          const rows = await db
            .select({
              surveyId: surveyResponses.surveyId,
              count: sql<number>`count(*)::int`,
            })
            .from(surveyResponses)
            .groupBy(surveyResponses.surveyId);
          return Object.fromEntries(rows.map((r) => [r.surveyId, r.count]));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return {};
        }
      },
    },
    media: {
      async list() {
        const db = getDb();
        try {
          return await db
            .select({
              id: mediaFiles.id,
              createdAt: mediaFiles.createdAt,
              name: mediaFiles.name,
              contentType: mediaFiles.contentType,
              size: mediaFiles.size,
              altText: mediaFiles.altText,
              uploadedBy: mediaFiles.uploadedBy,
            })
            .from(mediaFiles)
            .orderBy(desc(mediaFiles.createdAt));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return [];
        }
      },
      async get(id) {
        const db = getDb();
        try {
          const [row] = await db
            .select()
            .from(mediaFiles)
            .where(eq(mediaFiles.id, id))
            .limit(1);
          return row ?? null;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return null;
        }
      },
      async create(row) {
        const db = getDb();
        const doInsert = () =>
          db.insert(mediaFiles).values(row).returning({
              id: mediaFiles.id,
              createdAt: mediaFiles.createdAt,
              name: mediaFiles.name,
              contentType: mediaFiles.contentType,
              size: mediaFiles.size,
              altText: mediaFiles.altText,
              uploadedBy: mediaFiles.uploadedBy,
            });
        try {
          const [inserted] = await doInsert();
          return inserted;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          await ensureMediaTables(db);
          const [inserted] = await doInsert();
          return inserted;
        }
      },
      async update(id, patch) {
        const db = getDb();
        try {
          await db.update(mediaFiles).set(patch).where(eq(mediaFiles.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async remove(id) {
        const db = getDb();
        try {
          await db.delete(mediaFiles).where(eq(mediaFiles.id, id));
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
        }
      },
      async totalBytes() {
        const db = getDb();
        try {
          const [row] = await db
            .select({ total: sql<number>`coalesce(sum(${mediaFiles.size}), 0)::int` })
            .from(mediaFiles);
          return row?.total ?? 0;
        } catch (err) {
          if (!isMissingRelation(err)) throw err;
          return 0;
        }
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Mock (in-memory) implementations                                           */
/* -------------------------------------------------------------------------- */

function mockRepos(): RepoBundle {
  const audits: AuditLogRow[] = [];
  const tokens = new Map<string, PortalTokenRow>();
  const otpEvents: OtpAttemptRow[] = [];
  const mockOtpCodeStore = new Map<string, { code: string; expiresAt: Date; attempts: number }>();
  const transcripts: ChatTranscriptRow[] = [];
  const activityEntries: ActivityRow[] = seedActivities();
  const leaveEntries: LeaveRow[] = seedLeaves();
  const eodBriefEntries: EodBriefRow[] = [];
  const postSettlementEntries: PostSettlementCheckInRow[] = [];
  const pipelineSnapshotEntries: PipelineSnapshotRow[] = [];
  const lenderSlaEntries: LenderSlaRow[] = [];
  const mockDealStore = new Map<string, Deal>();
  let mockLastImport: ImportMeta | null = null;
  const mockDealNotesStore: DealNoteRow[] = [];
  const mockReferrerStore = new Map<string, ReferrerRow>();
  const mockSurveyStore = new Map<string, SurveyRow>();
  const mockSurveyResponseStore = new Map<string, SurveyResponseRow>();
  const mockCampaignStore = new Map<string, CampaignRow>();
  /** Keyed "<campaignId>:<email>" so the mock enforces the same
   *  one-email-per-campaign rule the unique index does in Postgres. */
  const mockRecipientStore = new Map<string, CampaignRecipientRow>();
  const mockSuppressionStore = new Map<string, EmailSuppressionRow>();
  /** Keyed "<campaignId>:<url>", mirroring the unique index. */
  const mockLinkClickStore = new Map<string, CampaignLinkClickRow>();
  const mockAutomationStore = new Map<string, AutomationRow>();
  /** Keyed "<automationId>:<email>", mirroring the unique index. */
  const mockRunStore = new Map<string, AutomationRunRow>();
  const mockAutomationSendStore = new Map<string, AutomationSendRow>();
  const mockFormStore = new Map<string, FormRow>();
  const mockSubmissionStore = new Map<string, FormSubmissionRow>();
  const mockPageStore = new Map<string, LandingPageRow>();
  const mockTemplateStore = new Map<string, EmailTemplateRow>();
  /** Keyed "email\u0000tag", mirroring the unique index. */
  const mockTagStore = new Map<string, ContactTagRow>();
  const mockSegmentStore = new Map<string, AudienceSegmentRow>();
  let mockSettingsRow: MailflowSettingsRow | null = null;
  const mockMediaStore = new Map<string, MediaFileRow>();

  const newId = () => crypto.randomUUID();

  return {
    audit: {
      async insert(row) {
        const inserted: AuditLogRow = {
          id: newId(),
          createdAt: new Date(),
          actorType: row.actorType,
          actorId: row.actorId,
          action: row.action,
          dealId: row.dealId ?? null,
          meta: row.meta ?? null,
          ipAddress: row.ipAddress ?? null,
          userAgent: row.userAgent ?? null,
        };
        audits.unshift(inserted); // newest-first so list() is naturally sorted
        return inserted;
      },
      async list(filter = {}) {
        let rows = audits;
        if (filter.dealId) rows = rows.filter((r) => r.dealId === filter.dealId);
        if (filter.action) rows = rows.filter((r) => r.action === filter.action);
        return rows.slice(0, filter.limit ?? 200);
      },
    },
    portalTokens: {
      async insert(row) {
        const inserted: PortalTokenRow = {
          id: newId(),
          dealId: row.dealId,
          tokenHash: row.tokenHash,
          issuedBy: row.issuedBy,
          issuedAt: row.issuedAt ?? new Date(),
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt ?? null,
          revokedBy: row.revokedBy ?? null,
        };
        tokens.set(row.tokenHash, inserted);
        return inserted;
      },
      async findByHash(hash) {
        return tokens.get(hash) ?? null;
      },
      async revoke(hash, by) {
        const t = tokens.get(hash);
        if (t) {
          tokens.set(hash, { ...t, revokedAt: new Date(), revokedBy: by });
        }
      },
      async listByDeal(dealId) {
        return [...tokens.values()]
          .filter((t) => t.dealId === dealId)
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
      },
    },
    otp: {
      async insert(row) {
        otpEvents.push({
          id: newId(),
          createdAt: new Date(),
          dealId: row.dealId,
          method: row.method,
          success: row.success ?? 0,
          ipAddress: row.ipAddress ?? null,
        });
      },
      async countRecent(dealId, withinMinutes) {
        const since = Date.now() - withinMinutes * 60_000;
        return otpEvents.filter(
          (e) => e.dealId === dealId && e.createdAt.getTime() >= since,
        ).length;
      },
    },
    otpCode: {
      async upsert({ dealId, method, code, expiresAt }) {
        mockOtpCodeStore.set(`${dealId}:${method}`, { code, expiresAt, attempts: 0 });
      },
      async find(dealId, method) {
        return mockOtpCodeStore.get(`${dealId}:${method}`) ?? null;
      },
      async incrementAttempts(dealId, method) {
        const rec = mockOtpCodeStore.get(`${dealId}:${method}`);
        if (rec) rec.attempts++;
      },
      async delete(dealId, method) {
        mockOtpCodeStore.delete(`${dealId}:${method}`);
      },
    },
    chat: {
      async upsert(row) {
        const inserted: ChatTranscriptRow = {
          id: newId(),
          dealId: row.dealId,
          startedAt: row.startedAt ?? new Date(),
          endedAt: row.endedAt ?? null,
          messages: row.messages as ChatTranscriptMessage[],
        };
        transcripts.unshift(inserted);
        return inserted;
      },
      async listByDeal(dealId) {
        return transcripts.filter((t) => t.dealId === dealId);
      },
    },
    activity: {
      async insert(row) {
        const inserted: ActivityRow = {
          id: newId(),
          createdAt: new Date(),
          brokerId: row.brokerId,
          dealId: row.dealId ?? null,
          taskType: row.taskType,
          minutes: row.minutes,
          note: row.note ?? null,
          source: row.source ?? "auto",
        };
        activityEntries.unshift(inserted);
        return inserted;
      },
      async listBetween(since, until) {
        return activityEntries.filter(
          (a) => a.createdAt >= since && a.createdAt <= until,
        );
      },
      async listForBroker(brokerId, limit = 50) {
        return activityEntries
          .filter((a) => a.brokerId === brokerId)
          .slice(0, limit);
      },
    },
    leave: {
      async insert(row) {
        const inserted: LeaveRow = {
          id: newId(),
          createdAt: new Date(),
          memberId: row.memberId,
          coveringMemberId: row.coveringMemberId,
          startAt: row.startAt,
          endAt: row.endAt ?? null,
          reason: row.reason ?? null,
          createdBy: row.createdBy,
        };
        leaveEntries.unshift(inserted);
        return inserted;
      },
      async listActive(at = new Date()) {
        return leaveEntries.filter(
          (r) => r.startAt <= at && (!r.endAt || r.endAt >= at),
        );
      },
      async listRecent(limit = 50) {
        return leaveEntries.slice(0, limit);
      },
      async endLeave(id, endAt) {
        const found = leaveEntries.find((r) => r.id === id);
        if (found) found.endAt = endAt;
      },
    },
    eodBrief: {
      async insert(row) {
        const inserted: EodBriefRow = {
          id: newId(),
          createdAt: new Date(),
          dealId: row.dealId,
          brokerId: row.brokerId,
          generationDate: row.generationDate,
          subject: row.subject,
          body: row.body,
          status: row.status ?? "queued",
          sentAt: row.sentAt ?? null,
          dismissedAt: row.dismissedAt ?? null,
          aiSource: row.aiSource ?? "mock",
          source: row.source ?? "auto",
        };
        eodBriefEntries.unshift(inserted);
        return inserted;
      },
      async listQueuedForBroker(brokerId, date) {
        return eodBriefEntries.filter(
          (b) =>
            b.brokerId === brokerId &&
            b.status === "queued" &&
            (!date || b.generationDate === date),
        );
      },
      async findForDealOnDate(dealId, date) {
        return (
          eodBriefEntries.find(
            (b) => b.dealId === dealId && b.generationDate === date,
          ) ?? null
        );
      },
      async markSent(id, sentAt) {
        const found = eodBriefEntries.find((b) => b.id === id);
        if (found) {
          found.status = "sent";
          found.sentAt = sentAt;
        }
      },
      async markDismissed(id, dismissedAt) {
        const found = eodBriefEntries.find((b) => b.id === id);
        if (found) {
          found.status = "dismissed";
          found.dismissedAt = dismissedAt;
        }
      },
    },
    deal: {
      async list() {
        return [...mockDealStore.values()];
      },
      async listRaw() {
        // mockDealStore holds live Deal objects with Date fields; JSON
        // round-trip mirrors the jsonb path so the cached payload is
        // Date-free and Zod rebuilds the dates on parse.
        return [...mockDealStore.values()].map((d) => ({
          id: d.id,
          data: JSON.parse(JSON.stringify(d)) as unknown,
        }));
      },
      async get(id) {
        return mockDealStore.get(id) ?? null;
      },
      async upsert(deal) {
        mockDealStore.set(deal.id, deal);
        revalidateDeals();
      },
      async add(deal) {
        mockDealStore.set(deal.id, deal);
        revalidateDeals();
      },
      async replaceAll(newDeals) {
        mockDealStore.clear();
        for (const d of newDeals) mockDealStore.set(d.id, d);
        revalidateDeals();
        return mockDealStore.size;
      },
      async remove(id) {
        mockDealStore.delete(id);
        revalidateDeals();
      },
      async clear() {
        mockDealStore.clear();
        mockLastImport = null;
        revalidateDeals();
      },
      async count() {
        return mockDealStore.size;
      },
      async recordImport({ importedBy, filename, rowCount }) {
        mockLastImport = {
          importedAt: new Date().toISOString(),
          importedBy,
          filename,
          rowCount,
        };
      },
      async lastImport() {
        return mockLastImport;
      },
    },
    postSettlement: {
      async upsertPending({ dealId, kind, dueAt, assignedTo }) {
        const existing = postSettlementEntries.find(
          (r) => r.dealId === dealId && r.kind === kind,
        );
        if (existing) return existing;
        const inserted: PostSettlementCheckInRow = {
          id: newId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          dealId,
          kind,
          dueAt,
          status: "pending",
          snoozedUntil: null,
          sentAt: null,
          dismissedAt: null,
          dismissedBy: null,
          assignedTo: assignedTo ?? null,
          draftSubject: null,
          draftBody: null,
          draftSource: "template",
        };
        postSettlementEntries.push(inserted);
        return inserted;
      },
      async ensurePending(entries) {
        for (const e of entries) {
          const exists = postSettlementEntries.some(
            (r) => r.dealId === e.dealId && r.kind === e.kind,
          );
          if (exists) continue;
          postSettlementEntries.push({
            id: newId(),
            createdAt: new Date(),
            updatedAt: new Date(),
            dealId: e.dealId,
            kind: e.kind,
            dueAt: e.dueAt,
            status: "pending",
            snoozedUntil: null,
            sentAt: null,
            dismissedAt: null,
            dismissedBy: null,
            assignedTo: e.assignedTo ?? null,
            draftSubject: null,
            draftBody: null,
            draftSource: "template",
          });
        }
      },
      async list({ includeDismissed = false }) {
        return postSettlementEntries
          .filter((r) => includeDismissed || r.status !== "dismissed")
          .slice()
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      },
      async findById(id) {
        return postSettlementEntries.find((r) => r.id === id) ?? null;
      },
      async markSent(id, sentAt) {
        const found = postSettlementEntries.find((r) => r.id === id);
        if (found) {
          found.status = "sent";
          found.sentAt = sentAt;
          found.updatedAt = new Date();
        }
      },
      async markDismissed(id, dismissedAt, dismissedBy) {
        const found = postSettlementEntries.find((r) => r.id === id);
        if (found) {
          found.status = "dismissed";
          found.dismissedAt = dismissedAt;
          found.dismissedBy = dismissedBy;
          found.updatedAt = new Date();
        }
      },
      async snooze(id, snoozedUntil) {
        const found = postSettlementEntries.find((r) => r.id === id);
        if (found) {
          found.status = "snoozed";
          found.snoozedUntil = snoozedUntil;
          found.updatedAt = new Date();
        }
      },
      async assign(id, assignedTo) {
        const found = postSettlementEntries.find((r) => r.id === id);
        if (found) {
          found.assignedTo = assignedTo;
          found.updatedAt = new Date();
        }
      },
      async setDraft(id, draft) {
        const found = postSettlementEntries.find((r) => r.id === id);
        if (found) {
          found.draftSubject = draft.subject;
          found.draftBody = draft.body;
          found.draftSource = draft.source;
          found.updatedAt = new Date();
        }
      },
      async listForPreDrafting({ days, asOf }) {
        const now = asOf ?? new Date();
        const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        return postSettlementEntries.filter(
          (r) => r.status === "pending" && r.dueAt <= horizon,
        );
      },
      async listExpiredSnoozes(asOf) {
        const now = asOf ?? new Date();
        return postSettlementEntries.filter(
          (r) => r.status === "snoozed" && r.snoozedUntil && r.snoozedUntil <= now,
        );
      },
    },
    pipelineSnapshot: {
      async record({ snapshotDate, counts }) {
        const existing = pipelineSnapshotEntries.find(
          (r) => r.snapshotDate === snapshotDate,
        );
        if (existing) {
          existing.counts = counts;
          existing.createdAt = new Date();
          return;
        }
        pipelineSnapshotEntries.push({
          id: newId(),
          createdAt: new Date(),
          snapshotDate,
          counts,
        });
      },
      async onOrBefore(date) {
        const candidates = pipelineSnapshotEntries
          .filter((r) => r.snapshotDate <= date)
          .sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1));
        return candidates[0] ?? null;
      },
    },
    lenderSla: {
      async all() {
        return lenderSlaEntries.slice();
      },
      async upsert({ lenderId, purchaseAssessDays, refinanceAssessDays, preApprovalDays, formalDays, updatedBy }) {
        const existing = lenderSlaEntries.find((r) => r.lenderId === lenderId);
        if (existing) {
          existing.purchaseAssessDays = purchaseAssessDays;
          existing.refinanceAssessDays = refinanceAssessDays;
          existing.preApprovalDays = preApprovalDays;
          existing.formalDays = formalDays;
          existing.updatedBy = updatedBy;
          existing.updatedAt = new Date();
          return;
        }
        lenderSlaEntries.push({
          lenderId,
          purchaseAssessDays,
          refinanceAssessDays,
          preApprovalDays,
          formalDays,
          updatedAt: new Date(),
          updatedBy,
        });
      },
    },
    dealNotes: {
      async add(row) {
        const note: DealNoteRow = {
          id: newId(),
          createdAt: new Date(),
          dealId: row.dealId,
          body: row.body,
          stampedBody: row.stampedBody,
          templateId: row.templateId ?? null,
          createdBy: row.createdBy,
        };
        mockDealNotesStore.push(note);
        return note;
      },
      async listByDeal(dealId) {
        return mockDealNotesStore
          .filter((n) => n.dealId === dealId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },
    referrer: {
      async add(row) {
        const ref: ReferrerRow = {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone ?? "",
          company: row.company ?? "",
          type: row.type ?? "other",
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          lastAccessedAt: row.lastAccessedAt ?? null,
          leadsCount: row.leadsCount ?? 0,
          isActive: row.isActive ?? true,
          createdAt: new Date(),
          createdBy: row.createdBy,
        };
        mockReferrerStore.set(row.id, ref);
        return ref;
      },
      async list(filter = {}) {
        let rows = Array.from(mockReferrerStore.values())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (filter.createdBy !== undefined) rows = rows.filter((r) => r.createdBy === filter.createdBy);
        if (filter.isActive !== undefined) rows = rows.filter((r) => r.isActive === filter.isActive);
        return rows;
      },
      async findById(id) {
        return mockReferrerStore.get(id) ?? null;
      },
      async findByTokenHash(hash) {
        return Array.from(mockReferrerStore.values()).find((r) => r.tokenHash === hash) ?? null;
      },
      async deactivate(id) {
        const r = mockReferrerStore.get(id);
        if (r) mockReferrerStore.set(id, { ...r, isActive: false });
      },
      async reissueToken(id, tokenHash, expiresAt) {
        const r = mockReferrerStore.get(id);
        if (r) mockReferrerStore.set(id, { ...r, tokenHash, expiresAt, isActive: true });
      },
      async incrementLeadsCount(id) {
        const r = mockReferrerStore.get(id);
        if (r) mockReferrerStore.set(id, { ...r, leadsCount: r.leadsCount + 1 });
      },
      async updateLastAccessed(id) {
        const r = mockReferrerStore.get(id);
        if (r) mockReferrerStore.set(id, { ...r, lastAccessedAt: new Date() });
      },
    },
    campaign: {
      async create(row) {
        const id = row.id ?? `camp-${mockCampaignStore.size + 1}`;
        const now = new Date();
        const campaign: CampaignRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          subject: row.subject ?? "",
          body: row.body ?? "",
          status: row.status ?? "draft",
          audience: row.audience,
          fromBrokerId: row.fromBrokerId,
          createdBy: row.createdBy,
          scheduledFor: row.scheduledFor ?? null,
          startedAt: row.startedAt ?? null,
          completedAt: row.completedAt ?? null,
          trackOpens: row.trackOpens ?? true,
          trackClicks: row.trackClicks ?? true,
          subjectB: row.subjectB ?? null,
          abTestPercent: row.abTestPercent ?? 30,
          abDecideAfterHours: row.abDecideAfterHours ?? 4,
          abWinner: row.abWinner ?? null,
          abDecidedAt: row.abDecidedAt ?? null,
        };
        mockCampaignStore.set(id, campaign);
        return campaign;
      },
      async update(id, patch) {
        const existing = mockCampaignStore.get(id);
        if (!existing) return;
        mockCampaignStore.set(id, {
          ...existing,
          ...patch,
          updatedAt: new Date(),
        } as CampaignRow);
      },
      async get(id) {
        return mockCampaignStore.get(id) ?? null;
      },
      async list(filter = {}) {
        let rows = Array.from(mockCampaignStore.values()).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        if (filter.statuses?.length) {
          rows = rows.filter((c) => filter.statuses!.includes(c.status));
        }
        return rows;
      },
      async remove(id) {
        mockCampaignStore.delete(id);
        for (const [key, r] of mockRecipientStore) {
          if (r.campaignId === id) mockRecipientStore.delete(key);
        }
      },
      async dueForDispatch(now) {
        return Array.from(mockCampaignStore.values()).filter(
          (c) =>
            c.status === "sending" ||
            (c.status === "scheduled" &&
              c.scheduledFor !== null &&
              c.scheduledFor <= now),
        );
      },
      async setRecipients(campaignId, rows) {
        for (const [key, r] of mockRecipientStore) {
          if (r.campaignId === campaignId) mockRecipientStore.delete(key);
        }
        let landed = 0;
        for (const row of rows) {
          const email = row.email.toLowerCase();
          const key = `${campaignId}:${email}`;
          if (mockRecipientStore.has(key)) continue;
          mockRecipientStore.set(key, {
            id: key,
            campaignId,
            email,
            name: row.name ?? "",
            firstName: row.firstName ?? "",
            variant: row.variant ?? null,
            sourceKind: row.sourceKind,
            sourceId: row.sourceId,
            fields: row.fields ?? null,
            status: row.status ?? "pending",
            skipReason: row.skipReason ?? null,
            error: row.error ?? null,
            sentAt: row.sentAt ?? null,
            openedAt: row.openedAt ?? null,
            clickedAt: row.clickedAt ?? null,
            unsubscribedAt: row.unsubscribedAt ?? null,
          });
          landed += 1;
        }
        return landed;
      },
      async listRecipients(campaignId, filter = {}) {
        let rows = Array.from(mockRecipientStore.values())
          .filter((r) => r.campaignId === campaignId)
          .sort((a, b) => a.email.localeCompare(b.email));
        if (filter.statuses?.length) {
          rows = rows.filter((r) => filter.statuses!.includes(r.status));
        }
        return rows.slice(0, filter.limit ?? 1000);
      },
      async clickTimestamps(limit = 20000) {
        return Array.from(mockRecipientStore.values())
          .flatMap((r) => (r.clickedAt ? [r.clickedAt] : []))
          .slice(0, limit);
      },
      async nextPending(campaignId, limit) {
        return Array.from(mockRecipientStore.values())
          .filter((r) => r.campaignId === campaignId && r.status === "pending")
          .sort((a, b) => a.email.localeCompare(b.email))
          .slice(0, limit);
      },
      async releaseHoldback(campaignId) {
        let released = 0;
        for (const [key, r] of mockRecipientStore) {
          if (r.campaignId === campaignId && r.status === "holdback") {
            mockRecipientStore.set(key, { ...r, status: "pending" });
            released += 1;
          }
        }
        return released;
      },
      async updateRecipient(id, patch) {
        const existing = mockRecipientStore.get(id);
        if (!existing) return;
        mockRecipientStore.set(id, { ...existing, ...patch } as CampaignRecipientRow);
      },
      async findRecipient(campaignId, email) {
        return mockRecipientStore.get(`${campaignId}:${email.toLowerCase()}`) ?? null;
      },
      async stats(campaignId) {
        const rows = Array.from(mockRecipientStore.values()).filter(
          (r) => r.campaignId === campaignId,
        );
        return {
          total: rows.length,
          pending: rows.filter((r) => r.status === "pending").length,
          sent: rows.filter((r) => r.status === "sent").length,
          failed: rows.filter((r) => r.status === "failed").length,
          skipped: rows.filter((r) => r.status === "skipped").length,
          opened: rows.filter((r) => r.openedAt !== null).length,
          clicked: rows.filter((r) => r.clickedAt !== null).length,
          unsubscribed: rows.filter((r) => r.unsubscribedAt !== null).length,
        };
      },
      async recordLinkClick(campaignId, url) {
        const key = `${campaignId}:${url}`;
        const existing = mockLinkClickStore.get(key);
        mockLinkClickStore.set(key, {
          id: key,
          campaignId,
          url,
          clicks: (existing?.clicks ?? 0) + 1,
          firstClickAt: existing?.firstClickAt ?? new Date(),
        });
      },
      async linkClicks(campaignId) {
        return Array.from(mockLinkClickStore.values())
          .filter((r) => r.campaignId === campaignId)
          .sort((a, b) => b.clicks - a.clicks);
      },
      async suppress(row) {
        const email = row.email.toLowerCase();
        if (mockSuppressionStore.has(email)) return;
        mockSuppressionStore.set(email, {
          email,
          createdAt: new Date(),
          reason: row.reason ?? "unsubscribe",
          campaignId: row.campaignId ?? null,
          addedBy: row.addedBy ?? "customer",
        });
      },
      async unsuppress(email) {
        mockSuppressionStore.delete(email.toLowerCase());
      },
      async listSuppressions(limit = 500) {
        return Array.from(mockSuppressionStore.values())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      },
      async suppressedAmong(emails) {
        const out = new Set<string>();
        for (const email of emails) {
          const lowered = email.toLowerCase();
          if (mockSuppressionStore.has(lowered)) out.add(lowered);
        }
        return out;
      },
    },
    automation: {
      async create(row) {
        const id = row.id ?? `auto-${mockAutomationStore.size + 1}`;
        const now = new Date();
        const automation: AutomationRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          status: row.status ?? "draft",
          flow: row.flow,
          fromBrokerId: row.fromBrokerId,
          createdBy: row.createdBy,
          activatedAt: row.activatedAt ?? null,
          trackOpens: row.trackOpens ?? true,
          trackClicks: row.trackClicks ?? true,
        };
        mockAutomationStore.set(id, automation);
        return automation;
      },
      async update(id, patch) {
        const existing = mockAutomationStore.get(id);
        if (!existing) return;
        mockAutomationStore.set(id, {
          ...existing,
          ...patch,
          updatedAt: new Date(),
        } as AutomationRow);
      },
      async get(id) {
        return mockAutomationStore.get(id) ?? null;
      },
      async list(filter = {}) {
        let rows = Array.from(mockAutomationStore.values()).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        if (filter.statuses?.length) {
          rows = rows.filter((a) => filter.statuses!.includes(a.status));
        }
        return rows;
      },
      async remove(id) {
        mockAutomationStore.delete(id);
        for (const [key, r] of mockRunStore) {
          if (r.automationId === id) mockRunStore.delete(key);
        }
        for (const [key, sRow] of mockAutomationSendStore) {
          if (sRow.automationId === id) mockAutomationSendStore.delete(key);
        }
      },
      async startRun(row) {
        const email = row.email.toLowerCase();
        const key = `${row.automationId}:${email}`;
        if (mockRunStore.has(key)) return null;
        const run: AutomationRunRow = {
          id: key,
          automationId: row.automationId,
          email,
          name: row.name ?? "",
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          fields: row.fields ?? null,
          status: row.status ?? "waiting",
          currentNodeId: row.currentNodeId,
          nodeEnteredAt: row.nodeEnteredAt ?? new Date(),
          nextRunAt: row.nextRunAt ?? null,
          enteredAt: new Date(),
          finishedAt: null,
          error: null,
        };
        mockRunStore.set(key, run);
        return run;
      },
      async updateRun(id, patch) {
        const existing = mockRunStore.get(id);
        if (!existing) return;
        mockRunStore.set(id, { ...existing, ...patch } as AutomationRunRow);
      },
      async dueRuns(now, limit) {
        return Array.from(mockRunStore.values())
          .filter(
            (r) =>
              r.status === "waiting" &&
              r.nextRunAt !== null &&
              r.nextRunAt <= now,
          )
          .sort(
            (a, b) => (a.nextRunAt?.getTime() ?? 0) - (b.nextRunAt?.getTime() ?? 0),
          )
          .slice(0, limit);
      },
      async listRuns(automationId, filter = {}) {
        let rows = Array.from(mockRunStore.values())
          .filter((r) => r.automationId === automationId)
          .sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime());
        if (filter.statuses?.length) {
          rows = rows.filter((r) => filter.statuses!.includes(r.status));
        }
        return rows.slice(0, filter.limit ?? 1000);
      },
      async enrolledEmails(automationId) {
        return new Set(
          Array.from(mockRunStore.values())
            .filter((r) => r.automationId === automationId)
            .map((r) => r.email),
        );
      },
      async recordSend(row) {
        const id = `send-${mockAutomationSendStore.size + 1}`;
        const send: AutomationSendRow = {
          id,
          runId: row.runId,
          automationId: row.automationId,
          nodeId: row.nodeId,
          email: row.email.toLowerCase(),
          sentAt: row.sentAt ?? null,
          openedAt: row.openedAt ?? null,
          clickedAt: row.clickedAt ?? null,
          unsubscribedAt: row.unsubscribedAt ?? null,
          error: row.error ?? null,
        };
        mockAutomationSendStore.set(id, send);
        return send;
      },
      async latestSendForRun(runId) {
        return (
          Array.from(mockAutomationSendStore.values())
            .filter((r) => r.runId === runId)
            .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0] ?? null
        );
      },
      async findSend(automationId, email) {
        const lowered = email.toLowerCase();
        return (
          Array.from(mockAutomationSendStore.values())
            .filter((r) => r.automationId === automationId && r.email === lowered)
            .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0] ?? null
        );
      },
      async updateSend(id, patch) {
        const existing = mockAutomationSendStore.get(id);
        if (!existing) return;
        mockAutomationSendStore.set(id, { ...existing, ...patch } as AutomationSendRow);
      },
      async nodeStats(automationId) {
        const byNode = new Map<string, AutomationNodeStats>();
        for (const row of mockAutomationSendStore.values()) {
          if (row.automationId !== automationId) continue;
          const entry = byNode.get(row.nodeId) ?? {
            nodeId: row.nodeId,
            sent: 0,
            opened: 0,
            clicked: 0,
            dropped: 0,
          };
          if (row.sentAt) entry.sent += 1;
          if (row.openedAt) entry.opened += 1;
          if (row.clickedAt) entry.clicked += 1;
          if (row.error) entry.dropped += 1;
          byNode.set(row.nodeId, entry);
        }
        return [...byNode.values()];
      },
    },
    form: {
      async create(row) {
        const id = row.id ?? `form-${mockFormStore.size + 1}`;
        const now = new Date();
        const form: FormRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          type: row.type,
          status: row.status ?? "draft",
          config: row.config,
          createdBy: row.createdBy,
          views: row.views ?? 0,
        };
        mockFormStore.set(id, form);
        return form;
      },
      async update(id, patch) {
        const existing = mockFormStore.get(id);
        if (!existing) return;
        mockFormStore.set(id, { ...existing, ...patch, updatedAt: new Date() } as FormRow);
      },
      async get(id) {
        return mockFormStore.get(id) ?? null;
      },
      async list(filter = {}) {
        let rows = Array.from(mockFormStore.values()).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        if (filter.types?.length) rows = rows.filter((f) => filter.types!.includes(f.type));
        if (filter.statuses?.length) {
          rows = rows.filter((f) => filter.statuses!.includes(f.status));
        }
        return rows;
      },
      async remove(id) {
        mockFormStore.delete(id);
        for (const [key, sub] of mockSubmissionStore) {
          if (sub.formId === id) mockSubmissionStore.delete(key);
        }
      },
      async recordView(id) {
        const form = mockFormStore.get(id);
        if (form) mockFormStore.set(id, { ...form, views: form.views + 1 });
      },
      async addSubmission(row) {
        const id = `sub-${mockSubmissionStore.size + 1}`;
        const submission: FormSubmissionRow = {
          id,
          formId: row.formId,
          pageId: row.pageId ?? null,
          submittedAt: new Date(),
          name: row.name ?? "",
          email: row.email ?? "",
          phone: row.phone ?? "",
          answers: row.answers ?? null,
          dealId: row.dealId ?? null,
          error: row.error ?? null,
          ipAddress: row.ipAddress ?? null,
          userAgent: row.userAgent ?? null,
        };
        mockSubmissionStore.set(id, submission);
        return submission;
      },
      async updateSubmission(id, patch) {
        const existing = mockSubmissionStore.get(id);
        if (!existing) return;
        mockSubmissionStore.set(id, { ...existing, ...patch } as FormSubmissionRow);
      },
      async listSubmissions(formId, limit = 200) {
        return Array.from(mockSubmissionStore.values())
          .filter((sub) => sub.formId === formId)
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
          .slice(0, limit);
      },
      async submissionCounts() {
        const out: Record<string, number> = {};
        for (const sub of mockSubmissionStore.values()) {
          out[sub.formId] = (out[sub.formId] ?? 0) + 1;
        }
        return out;
      },
      async pageSubmissionCounts() {
        const out: Record<string, number> = {};
        for (const sub of mockSubmissionStore.values()) {
          if (!sub.pageId) continue;
          out[sub.pageId] = (out[sub.pageId] ?? 0) + 1;
        }
        return out;
      },
    },
    landingPage: {
      async create(row) {
        const id = row.id ?? `page-${mockPageStore.size + 1}`;
        const now = new Date();
        const page: LandingPageRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          slug: row.slug,
          status: row.status ?? "draft",
          config: row.config,
          createdBy: row.createdBy,
          publishedAt: row.publishedAt ?? null,
          views: row.views ?? 0,
        };
        mockPageStore.set(id, page);
        return page;
      },
      async update(id, patch) {
        const existing = mockPageStore.get(id);
        if (!existing) return;
        mockPageStore.set(id, { ...existing, ...patch, updatedAt: new Date() } as LandingPageRow);
      },
      async get(id) {
        return mockPageStore.get(id) ?? null;
      },
      async bySlug(slug) {
        return (
          Array.from(mockPageStore.values()).find((p) => p.slug === slug) ?? null
        );
      },
      async list() {
        return Array.from(mockPageStore.values()).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      },
      async remove(id) {
        mockPageStore.delete(id);
      },
      async recordView(id) {
        const page = mockPageStore.get(id);
        if (page) mockPageStore.set(id, { ...page, views: page.views + 1 });
      },
    },
    emailTemplate: {
      async create(row) {
        const id = row.id ?? `tpl-${mockTemplateStore.size + 1}`;
        const now = new Date();
        const template: EmailTemplateRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          config: row.config,
          createdBy: row.createdBy,
          timesUsed: row.timesUsed ?? 0,
          lastUsedAt: row.lastUsedAt ?? null,
        };
        mockTemplateStore.set(id, template);
        return template;
      },
      async update(id, patch) {
        const existing = mockTemplateStore.get(id);
        if (!existing) return;
        mockTemplateStore.set(id, {
          ...existing,
          ...patch,
          updatedAt: new Date(),
        } as EmailTemplateRow);
      },
      async get(id) {
        return mockTemplateStore.get(id) ?? null;
      },
      async list() {
        return [...mockTemplateStore.values()].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      },
      async remove(id) {
        mockTemplateStore.delete(id);
      },
      async recordUse(id) {
        const existing = mockTemplateStore.get(id);
        if (!existing) return;
        mockTemplateStore.set(id, {
          ...existing,
          timesUsed: existing.timesUsed + 1,
          lastUsedAt: new Date(),
        });
      },
    },
    contactTag: {
      async list() {
        return [...mockTagStore.values()];
      },
      async counts() {
        const out = new Map<string, number>();
        for (const row of mockTagStore.values()) {
          out.set(row.tag, (out.get(row.tag) ?? 0) + 1);
        }
        return [...out.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => a.tag.localeCompare(b.tag));
      },
      async add(emails, tag, addedBy) {
        let added = 0;
        for (const email of emails) {
          const key = `${email}\u0000${tag}`;
          if (mockTagStore.has(key)) continue;
          mockTagStore.set(key, {
            id: `tag-${mockTagStore.size + 1}`,
            createdAt: new Date(),
            email,
            tag,
            addedBy,
          });
          added += 1;
        }
        return added;
      },
      async remove(emails, tag) {
        let removed = 0;
        for (const email of emails) {
          if (mockTagStore.delete(`${email}\u0000${tag}`)) removed += 1;
        }
        return removed;
      },
      async removeTagEntirely(tag) {
        for (const [key, row] of mockTagStore) {
          if (row.tag === tag) mockTagStore.delete(key);
        }
      },
    },
    segment: {
      async create(row) {
        const id = row.id ?? `seg-${mockSegmentStore.size + 1}`;
        const now = new Date();
        const segment: AudienceSegmentRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          description: row.description ?? "",
          filter: row.filter,
          createdBy: row.createdBy,
        };
        mockSegmentStore.set(id, segment);
        return segment;
      },
      async update(id, patch) {
        const existing = mockSegmentStore.get(id);
        if (!existing) return;
        mockSegmentStore.set(id, {
          ...existing,
          ...patch,
          updatedAt: new Date(),
        } as AudienceSegmentRow);
      },
      async get(id) {
        return mockSegmentStore.get(id) ?? null;
      },
      async list() {
        return [...mockSegmentStore.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      },
      async remove(id) {
        mockSegmentStore.delete(id);
      },
    },
    settings: {
      async get() {
        return mockSettingsRow;
      },
      async save(settings, updatedBy) {
        mockSettingsRow = {
          id: "mailflow",
          settings,
          updatedBy,
          updatedAt: new Date(),
        };
      },
    },
    survey: {
      async create(row) {
        const id = row.id ?? `survey-${mockSurveyStore.size + 1}`;
        const now = new Date();
        const created: SurveyRow = {
          id,
          createdAt: now,
          updatedAt: now,
          name: row.name,
          status: row.status ?? "draft",
          config: row.config,
          createdBy: row.createdBy,
          sent: row.sent ?? 0,
        } as SurveyRow;
        mockSurveyStore.set(id, created);
        return created;
      },
      async get(id) {
        return mockSurveyStore.get(id) ?? null;
      },
      async list(filter = {}) {
        let rows = Array.from(mockSurveyStore.values()).sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
        if (filter.statuses?.length) {
          rows = rows.filter((r) => filter.statuses!.includes(r.status));
        }
        return rows;
      },
      async update(id, patch) {
        const existing = mockSurveyStore.get(id);
        if (!existing) return;
        mockSurveyStore.set(id, {
          ...existing,
          ...patch,
          updatedAt: new Date(),
        } as SurveyRow);
      },
      async remove(id) {
        mockSurveyStore.delete(id);
        for (const [key, r] of mockSurveyResponseStore) {
          if (r.surveyId === id) mockSurveyResponseStore.delete(key);
        }
      },
      async countSent(id, by) {
        const existing = mockSurveyStore.get(id);
        if (!existing) return;
        mockSurveyStore.set(id, { ...existing, sent: existing.sent + by });
      },
      async saveResponse(row) {
        const email = row.email.toLowerCase();
        const key = `${row.surveyId}:${email}`;
        const existing = mockSurveyResponseStore.get(key);
        mockSurveyResponseStore.set(key, {
          id: existing?.id ?? `resp-${mockSurveyResponseStore.size + 1}`,
          surveyId: row.surveyId,
          email,
          name: row.name ?? existing?.name ?? "",
          answers: row.answers,
          submittedAt: row.submittedAt ?? new Date(),
          sourceKind: row.sourceKind ?? null,
          sourceId: row.sourceId ?? null,
        } as SurveyResponseRow);
      },
      async listResponses(surveyId, limit = 2000) {
        return Array.from(mockSurveyResponseStore.values())
          .filter((r) => r.surveyId === surveyId)
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
          .slice(0, limit);
      },
      async findResponse(surveyId, email) {
        return (
          mockSurveyResponseStore.get(`${surveyId}:${email.toLowerCase()}`) ??
          null
        );
      },
      async responseCounts() {
        const out: Record<string, number> = {};
        for (const r of mockSurveyResponseStore.values()) {
          out[r.surveyId] = (out[r.surveyId] ?? 0) + 1;
        }
        return out;
      },
    },
    media: {
      async list() {
        return [...mockMediaStore.values()]
          .map(({ data: _data, ...rest }) => rest)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async get(id) {
        return mockMediaStore.get(id) ?? null;
      },
      async create(row) {
        const id = row.id ?? `file-${mockMediaStore.size + 1}`;
        const file: MediaFileRow = {
          id,
          createdAt: new Date(),
          name: row.name,
          contentType: row.contentType,
          size: row.size,
          data: row.data,
          altText: row.altText ?? "",
          uploadedBy: row.uploadedBy,
        };
        mockMediaStore.set(id, file);
        const { data: _data, ...summary } = file;
        return summary;
      },
      async update(id, patch) {
        const existing = mockMediaStore.get(id);
        if (!existing) return;
        mockMediaStore.set(id, { ...existing, ...patch });
      },
      async remove(id) {
        mockMediaStore.delete(id);
      },
      async totalBytes() {
        let total = 0;
        for (const f of mockMediaStore.values()) total += f.size;
        return total;
      },
    },
  };
}

/**
 * Seed the mock activity feed so the productivity section of /reports
 * renders meaningfully on first load. Spread across the last 30 days
 * with realistic role splits — Loan Associates (mp, nn) carry the
 * follow-up + returned-app load, brokers (mm, na, rl, ds) carry new
 * deals + repricings. Replaced by real entries the moment a real
 * action fires; the seed is only there so demos + capacity views
 * aren't an empty state.
 */
function seedActivities(): ActivityRow[] {
  const newId = () => crypto.randomUUID();
  const now = new Date();
  const day = (offset: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const seeds: Array<{
    daysAgo: number; hour: number; minute: number;
    brokerId: string; taskType: string; minutes: number;
    dealId?: string | null; note?: string | null;
  }> = [
    // ---- today ----
    // Maddison (associate) chasing docs on Michael's pre-lodgement files
    { daysAgo: 0, hour:  8, minute: 30, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l1" },
    { daysAgo: 0, hour:  9, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l5" },
    { daysAgo: 0, hour:  9, minute: 15, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l1" },
    { daysAgo: 0, hour:  9, minute: 30, brokerId: "mm", taskType: "new-deal-purchase",    minutes: 65, dealId: "l11", note: "Initial assessment" },
    // Nick chasing on Nathan + Dylan's files
    { daysAgo: 0, hour: 10, minute:  0, brokerId: "nn", taskType: "follow-up",            minutes: 5,  dealId: "l2" },
    { daysAgo: 0, hour: 10, minute: 30, brokerId: "nn", taskType: "follow-up",            minutes: 5,  dealId: "l4" },
    { daysAgo: 0, hour: 11, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l3" },
    { daysAgo: 0, hour: 11, minute: 15, brokerId: "rl", taskType: "repricing",            minutes: 5,  dealId: null },
    { daysAgo: 0, hour: 13, minute:  0, brokerId: "nn", taskType: "returned-app",         minutes: 30, dealId: "l6", note: "Customer returned ID + payslips" },
    { daysAgo: 0, hour: 14, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l5" },
    { daysAgo: 0, hour: 14, minute: 30, brokerId: "mm", taskType: "follow-up",            minutes: 5,  dealId: "l1" },
    // ---- yesterday ----
    { daysAgo: 1, hour:  9, minute:  0, brokerId: "mm", taskType: "new-deal-refinance",   minutes: 60, dealId: "l1" },
    { daysAgo: 1, hour: 10, minute: 30, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l1" },
    { daysAgo: 1, hour: 11, minute:  0, brokerId: "mp", taskType: "returned-app",         minutes: 30, dealId: "l3" },
    { daysAgo: 1, hour: 13, minute:  0, brokerId: "nn", taskType: "follow-up",            minutes: 5,  dealId: "l4" },
    { daysAgo: 1, hour: 14, minute:  0, brokerId: "rl", taskType: "new-deal-purchase",    minutes: 65, dealId: "l3" },
    { daysAgo: 1, hour: 16, minute:  0, brokerId: "nn", taskType: "returned-app",         minutes: 30, dealId: "l2", note: "Bank statements returned" },
    // ---- 2 days ago ----
    { daysAgo: 2, hour:  9, minute: 30, brokerId: "ds", taskType: "new-deal-refinance",   minutes: 60, dealId: "l4" },
    { daysAgo: 2, hour: 10, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l3" },
    { daysAgo: 2, hour: 11, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l5" },
    { daysAgo: 2, hour: 14, minute: 30, brokerId: "mm", taskType: "repricing",            minutes: 5 },
    { daysAgo: 2, hour: 15, minute:  0, brokerId: "nn", taskType: "follow-up",            minutes: 5,  dealId: "l4" },
    // ---- 3 days ago ----
    { daysAgo: 3, hour:  9, minute:  0, brokerId: "mp", taskType: "returned-app",         minutes: 30, dealId: "l1", note: "Rental ledger arrived" },
    { daysAgo: 3, hour: 10, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l11" },
    { daysAgo: 3, hour: 11, minute:  0, brokerId: "rl", taskType: "new-deal-refinance",   minutes: 60, dealId: "l12" },
    { daysAgo: 3, hour: 14, minute:  0, brokerId: "nn", taskType: "follow-up",            minutes: 5,  dealId: "l6" },
    // ---- earlier this week ----
    { daysAgo: 4, hour:  9, minute: 30, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l5" },
    { daysAgo: 4, hour: 10, minute:  0, brokerId: "mm", taskType: "new-deal-purchase",    minutes: 65, dealId: "l13" },
    { daysAgo: 4, hour: 15, minute:  0, brokerId: "mp", taskType: "follow-up",            minutes: 5,  dealId: "l3" },
    { daysAgo: 6, hour: 11, minute:  0, brokerId: "na", taskType: "new-deal-refinance",   minutes: 60, dealId: "l6" },
    { daysAgo: 6, hour: 14, minute:  0, brokerId: "nn", taskType: "returned-app",         minutes: 30, dealId: "l6" },
    // ---- last week ----
    { daysAgo: 8,  hour: 13, minute:  0, brokerId: "mp", taskType: "returned-app",        minutes: 30, dealId: "l3" },
    { daysAgo: 9,  hour: 10, minute:  0, brokerId: "mp", taskType: "follow-up",           minutes: 5,  dealId: "l1" },
    { daysAgo: 10, hour: 14, minute:  0, brokerId: "nn", taskType: "follow-up",           minutes: 5,  dealId: "l4" },
    { daysAgo: 11, hour: 11, minute:  0, brokerId: "mm", taskType: "new-deal-purchase",   minutes: 65 },
    { daysAgo: 12, hour: 15, minute: 30, brokerId: "na", taskType: "repricing",           minutes: 5 },
    // ---- earlier this month ----
    { daysAgo: 18, hour: 10, minute:  0, brokerId: "mm", taskType: "new-deal-refinance",  minutes: 60, dealId: "l7" },
    { daysAgo: 22, hour: 13, minute:  0, brokerId: "rl", taskType: "new-deal-purchase",   minutes: 65, dealId: "l8" },
    { daysAgo: 25, hour: 11, minute:  0, brokerId: "nn", taskType: "follow-up",           minutes: 5,  dealId: "l10" },
  ];

  return seeds.map((s) => ({
    id: newId(),
    createdAt: day(s.daysAgo, s.hour, s.minute),
    brokerId: s.brokerId,
    dealId: s.dealId ?? null,
    taskType: s.taskType,
    minutes: s.minutes,
    note: s.note ?? null,
    source: "auto",
  }));
}

/**
 * Seed one active leave so the handover UI has something to render
 * out of the box. Maddison is "on annual leave" with Nick covering
 * her deals — easy to demo + delete from the UI.
 */
function seedLeaves(): LeaveRow[] {
  const newId = () => crypto.randomUUID();
  const now = new Date();
  const startAt = new Date(now);
  startAt.setDate(startAt.getDate() - 2);
  startAt.setHours(8, 0, 0, 0);
  const endAt = new Date(now);
  endAt.setDate(endAt.getDate() + 5);
  endAt.setHours(17, 0, 0, 0);

  return [
    {
      id: newId(),
      createdAt: new Date(startAt),
      memberId: "mp",
      coveringMemberId: "nn",
      startAt,
      endAt,
      reason: "Annual leave",
      createdBy: "mm",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Singleton factory                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The bundle is cached on globalThis rather than in a module-level
 * variable.
 *
 * Next gives route handlers a different module instance from pages, so a
 * module-level cache means the in-memory mock repos are a *different*
 * store in each: a form created through a page was invisible to
 * /api/forms/[id]/submit, which 404'd on a record that plainly existed.
 * Real Postgres hides this — both instances read the same database — so
 * it only ever bites in mock mode, which is exactly where a developer is
 * least expecting it and most likely to conclude the feature is broken.
 *
 * Pinning to globalThis gives every module instance the same bundle. It
 * also survives dev hot-reload, which the module-level version did not.
 */
const REPO_KEY = Symbol.for("mankin.repos");

type RepoGlobal = typeof globalThis & { [REPO_KEY]?: RepoBundle };

export function repos(): RepoBundle {
  const store = globalThis as RepoGlobal;
  const singleton = store[REPO_KEY];
  if (singleton) return singleton;
  // Use real Postgres whenever a DATABASE_URL is configured. No DB URL →
  // in-memory mock (local dev, and any deploy without storage attached).
  // MOCK_DB="true" force-mocks even when a URL is present, for testing.
  //
  // This used to require MOCK_DB === "false" as well, which was a trap:
  // attaching a database silently did nothing and every write (CX review
  // sends, follow-up tracking, tracker edits) kept resetting on redeploy.
  const built =
    !process.env.DATABASE_URL || process.env.MOCK_DB === "true"
      ? mockRepos()
      : realRepos();
  store[REPO_KEY] = built;
  return built;
}

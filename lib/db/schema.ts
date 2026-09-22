import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle schema for the Mankin Finance app.
 *
 * Tables here cover the local persistence Salestrekker doesn't own:
 *  - audit_log: every read/write/download, per security.jsx + ASIC RG209
 *  - portal_tokens: issued portal URLs (for revocation + audit, even though
 *    the JWT is itself stateless)
 *  - otp_attempts: rate-limiting + abuse signal across restarts
 *  - chat_transcripts: persistent copy of portal Claude chats (Salestrekker
 *    notes are also written on portal close, but those can be incomplete
 *    if the customer never closes the tab cleanly)
 *
 * Schema migrations live in ./drizzle/ and are generated via
 * `pnpm db:generate`, applied via `pnpm db:migrate`.
 */

/* -------------------------------------------------------------------------- */
/* audit_log — append-only record of everything sensitive                     */
/* -------------------------------------------------------------------------- */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** broker | customer | system */
    actorType: text("actor_type").notNull(),
    /** for brokers: team id (mm/na/...); for customers: deal id; system: 'system' */
    actorId: text("actor_id").notNull(),

    /** stable verb, e.g. portal.upload, composer.send.email, portal.token.issue */
    action: text("action").notNull(),

    /** Most events relate to a deal — null for org-wide actions */
    dealId: text("deal_id"),

    /** Free-form context — file name, doc id, msg id, etc. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),

    /** Best-effort client IP + UA — populated when the action came in via HTTP */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_deal_id_idx").on(t.dealId),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

/* -------------------------------------------------------------------------- */
/* portal_tokens — record of every customer link issued                       */
/* -------------------------------------------------------------------------- */

export const portalTokens = pgTable(
  "portal_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dealId: text("deal_id").notNull(),
    /** JWT jti or sha256(token) — never store the full JWT */
    tokenHash: text("token_hash").notNull().unique(),

    issuedBy: text("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** null until manually revoked */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
  },
  (t) => [
    index("portal_tokens_deal_id_idx").on(t.dealId),
    index("portal_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export type PortalTokenRow = typeof portalTokens.$inferSelect;
export type NewPortalToken = typeof portalTokens.$inferInsert;

/* -------------------------------------------------------------------------- */
/* otp_attempts — rate-limit signal for portal verification                   */
/* -------------------------------------------------------------------------- */

export const otpAttempts = pgTable(
  "otp_attempts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    dealId: text("deal_id").notNull(),
    method: text("method").notNull(), // sms | email
    success: integer("success").notNull().default(0), // 0 | 1
    ipAddress: text("ip_address"),
  },
  (t) => [
    index("otp_attempts_deal_id_idx").on(t.dealId),
    index("otp_attempts_created_at_idx").on(t.createdAt),
  ],
);

export type OtpAttemptRow = typeof otpAttempts.$inferSelect;
export type NewOtpAttempt = typeof otpAttempts.$inferInsert;

/* -------------------------------------------------------------------------- */
/* otp_codes — short-lived OTP codes, persisted across serverless invocations */
/* -------------------------------------------------------------------------- */

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dealId: text("deal_id").notNull(),
    method: text("method").notNull(),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("otp_codes_deal_method_idx").on(t.dealId, t.method),
    index("otp_codes_expires_at_idx").on(t.expiresAt),
  ],
);

export type OtpCodeRow = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;

/* -------------------------------------------------------------------------- */
/* chat_transcripts — persistent backup of portal Claude conversations        */
/* -------------------------------------------------------------------------- */

export interface ChatTranscriptMessage {
  role: "user" | "assistant";
  content: string;
  at: string; // ISO 8601
}

export const chatTranscripts = pgTable(
  "chat_transcripts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dealId: text("deal_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    messages: jsonb("messages").$type<ChatTranscriptMessage[]>().notNull(),
  },
  (t) => [index("chat_transcripts_deal_id_idx").on(t.dealId)],
);

export type ChatTranscriptRow = typeof chatTranscripts.$inferSelect;
export type NewChatTranscript = typeof chatTranscripts.$inferInsert;

/* -------------------------------------------------------------------------- */
/* activities — productivity log driving the Reports productivity section      */
/* -------------------------------------------------------------------------- */

/**
 * Every broker action that takes meaningful time gets a row here:
 *  - follow-up (5 min, auto-logged by dashboard.composer.send)
 *  - new-deal-refinance (60 min, broker logs via "Log task" button)
 *  - new-deal-purchase (65 min, ditto)
 *  - returned-app (30 min, auto-logged when a settled deal moves
 *    back to an earlier stage)
 *  - repricing (5 min, manual)
 *
 * Time budgets live in lib/productivity.ts so the dashboard can
 * compute "X hours logged this week" without each repo caller doing
 * the math.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** TEAM id (mm, na, rl, ds, nn, mp) */
    brokerId: text("broker_id").notNull(),
    /** Optional — null for repricings or generic admin */
    dealId: text("deal_id"),

    /** Stable TaskType enum value, e.g. "follow-up" */
    taskType: text("task_type").notNull(),
    /** Standard duration in minutes — denormalised so a future TASK_TIMINGS
     *  edit doesn't retroactively change historic hours. */
    minutes: integer("minutes").notNull(),

    /** Optional free-form note from the broker */
    note: text("note"),
    /**
     * What surfaced this entry: 'auto' (server-action triggered) or
     * 'manual' (broker pressed Log task). Useful for audit + debugging.
     */
    source: text("source").notNull().default("auto"),
  },
  (t) => [
    index("activities_broker_id_idx").on(t.brokerId),
    index("activities_created_at_idx").on(t.createdAt),
    index("activities_task_type_idx").on(t.taskType),
  ],
);

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;

/* -------------------------------------------------------------------------- */
/* leaves — handover register for staff on leave + who's covering             */
/* -------------------------------------------------------------------------- */

/**
 * One row per leave window. When a person is on leave their workload
 * routes to the covering person — the capacity calculator picks the
 * active row up via lib/handover.ts.
 *
 * Brokers can extend a leave by inserting a new row (we don't UPDATE
 * historical leaves; closing = endedAt + insert a new one if needed).
 * That keeps the leaves table act as an append-mostly audit trail
 * which RG209 compliance reviewers can read end-to-end.
 */
export const leaves = pgTable(
  "leaves",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** TEAM id of the person on leave */
    memberId: text("member_id").notNull(),
    /** TEAM id of who's covering the workload */
    coveringMemberId: text("covering_member_id").notNull(),

    /** ISO datetime — when the leave kicks in */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** ISO datetime — when the leave ends; null while still ongoing */
    endAt: timestamp("end_at", { withTimezone: true }),

    /** Free-form, e.g. "parental leave", "annual leave", "study" */
    reason: text("reason"),

    /** Who recorded the leave — usually a broker / office admin */
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("leaves_member_id_idx").on(t.memberId),
    index("leaves_covering_member_id_idx").on(t.coveringMemberId),
    index("leaves_start_at_idx").on(t.startAt),
  ],
);

export type LeaveRow = typeof leaves.$inferSelect;
export type NewLeave = typeof leaves.$inferInsert;

/* -------------------------------------------------------------------------- */
/* eod_briefs — daily "where we're up to" customer update drafts              */
/* -------------------------------------------------------------------------- */

/**
 * End-of-day briefs. One row per (deal, generation date). Status flows:
 *   queued  → sent  (broker hit Send)
 *   queued  → dismissed (broker hit Skip)
 *
 * Generation is day-idempotent — re-running the generate action on the
 * same calendar day for the same broker won't duplicate rows. Each row
 * carries the full subject + body so we have an audit trail of what was
 * drafted vs what was sent (useful for compliance + tuning the prompt).
 */
export const eodBriefs = pgTable(
  "eod_briefs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** The deal we drafted an update about */
    dealId: text("deal_id").notNull(),
    /** Broker the update is addressed FROM — who will send it */
    brokerId: text("broker_id").notNull(),

    /** Whole-day bucket for idempotency: YYYY-MM-DD */
    generationDate: text("generation_date").notNull(),

    /** Drafted subject + body — broker can review before sending */
    subject: text("subject").notNull(),
    body: text("body").notNull(),

    /** "queued" | "sent" | "dismissed" */
    status: text("status").notNull().default("queued"),
    /** When the broker actioned the brief */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

    /** Did Claude draft this, or the deterministic fallback? */
    aiSource: text("ai_source").notNull().default("mock"),
    /** "auto" (cron) vs "manual" (broker pressed Generate now) */
    source: text("source").notNull().default("auto"),
  },
  (t) => [
    index("eod_briefs_broker_id_idx").on(t.brokerId),
    index("eod_briefs_deal_id_idx").on(t.dealId),
    index("eod_briefs_generation_date_idx").on(t.generationDate),
    index("eod_briefs_status_idx").on(t.status),
  ],
);

export type EodBriefRow = typeof eodBriefs.$inferSelect;
export type NewEodBrief = typeof eodBriefs.$inferInsert;

/* -------------------------------------------------------------------------- */
/* post_settlement_checkins — client experience queue                          */
/* -------------------------------------------------------------------------- */

/**
 * Post-settlement check-ins. One row per (deal, kind) pair where kind
 * is "3mo" | "6mo" | "9mo" | "12mo". Created on first access via an
 * idempotent upsert, then driven through these statuses:
 *
 *   pending   → ready  (cron pre-drafted the email content)
 *   pending   → snoozed (officer pushed it back)
 *   pending   → dismissed (officer decided not to send)
 *   pending   → sent (officer hit Send via Composer)
 *   ready     → sent / dismissed / snoozed (same)
 *   snoozed   → pending (when snoozedUntil passes)
 *
 * The officer's queue page filters out dismissed + snoozed-into-the-
 * future rows by default, so only pending + ready show up.
 */
export const postSettlementCheckIns = pgTable(
  "post_settlement_checkins",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** The settled deal this check-in is for */
    dealId: text("deal_id").notNull(),
    /** "3mo" | "6mo" | "9mo" | "12mo" */
    kind: text("kind").notNull(),
    /** Calculated from deal.settledOn + kind's offset days */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),

    /** Lifecycle status. See module doc above for transitions. */
    status: text("status").notNull().default("pending"),
    /** If status='snoozed', when does it become pending again */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /** When sent (status='sent') */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** When dismissed (status='dismissed') + by whom */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: text("dismissed_by"),

    /** TEAM id of the person responsible. Defaults to Client Experience
     *  officer on creation; can be reassigned. */
    assignedTo: text("assigned_to"),

    /** Pre-drafted email content (set by the daily cron). When null,
     *  the page falls back to the static template at compose time. */
    draftSubject: text("draft_subject"),
    draftBody: text("draft_body"),
    /** Who/what drafted it: "template" (default) | "anthropic" (Claude) */
    draftSource: text("draft_source").notNull().default("template"),
  },
  (t) => [
    index("post_settlement_checkins_deal_id_idx").on(t.dealId),
    index("post_settlement_checkins_status_idx").on(t.status),
    index("post_settlement_checkins_due_at_idx").on(t.dueAt),
    index("post_settlement_checkins_assigned_to_idx").on(t.assignedTo),
  ],
);

export type PostSettlementCheckInRow = typeof postSettlementCheckIns.$inferSelect;
export type NewPostSettlementCheckIn = typeof postSettlementCheckIns.$inferInsert;

/* -------------------------------------------------------------------------- */
/* deals — the imported / created deal dataset                                */
/* -------------------------------------------------------------------------- */

/**
 * Persisted dashboard deals. Replaces the in-memory imported-deals
 * Map so deals survive cold starts and redeploys.
 *
 * Source of truth for deals created via "+ New application" and
 * deals uploaded via /dashboard/import. The Salestrekker mock client
 * checks this table first, falling back to MOCK_DEALS for the seed
 * dataset when the table is empty.
 *
 * The full Deal payload lives in `data` as JSONB; reads parse it
 * through DealSchema so new fields default cleanly without a
 * migration. `broker_id` is hoisted out as a column so we can scope
 * queries per-broker later if needed.
 */
export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Owner broker id (from team.ts) for scoped queries. Hoisted out
     *  of the JSON payload as a column so it can be indexed. */
    brokerId: text("broker_id").notNull(),
    /** Full Deal payload (matches the Zod DealSchema). Parsed through
     *  the schema on read so missing-field defaults apply. */
    data: jsonb("data").notNull(),
  },
  (t) => [
    index("deals_broker_id_idx").on(t.brokerId),
    index("deals_updated_at_idx").on(t.updatedAt),
  ],
);

export type DealRow = typeof deals.$inferSelect;
export type NewDealRow = typeof deals.$inferInsert;

/**
 * Import session log. Each row is one upload via /dashboard/import.
 * Used to show "Last import" meta on the import page and as evidence
 * trail in the audit log alongside the auditLog rows themselves.
 */
export const dealImports = pgTable(
  "deal_imports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    importedBy: text("imported_by").notNull(),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull(),
  },
  (t) => [index("deal_imports_imported_at_idx").on(t.importedAt)],
);

export type DealImportRow = typeof dealImports.$inferSelect;
export type NewDealImport = typeof dealImports.$inferInsert;

/* -------------------------------------------------------------------------- */
/* deal_notes — broker notes stored per deal                                  */
/* -------------------------------------------------------------------------- */

export const dealNotes = pgTable(
  "deal_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    dealId: text("deal_id").notNull(),
    body: text("body").notNull(),
    stampedBody: text("stamped_body").notNull(),
    templateId: text("template_id"),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("deal_notes_deal_id_idx").on(t.dealId)],
);

export type DealNoteRow = typeof dealNotes.$inferSelect;
export type NewDealNote = typeof dealNotes.$inferInsert;

/* -------------------------------------------------------------------------- */
/* settlements — backbook from YBR commission spreadsheet                     */
/* -------------------------------------------------------------------------- */

/**
 * Settled loans, sourced from the monthly YBR Aggregation commission
 * XLSX (Upfront + Trail + Clawback sheets). One row per Loan ID; the
 * full SettlementRow payload sits in the jsonb column. The CX manager
 * runs anniversary reviews against this table.
 *
 * Settlement date is hoisted as a column so the anniversary cohort
 * queries are cheap. Status filters happen in code over the jsonb.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** Owner broker id from team.ts (matched best-effort during import). */
    brokerId: text("broker_id"),
    /** ISO yyyy-mm-dd. Indexed for anniversary cohort queries. */
    settlementDate: text("settlement_date"),
    /** Full SettlementRow payload. */
    data: jsonb("data").notNull(),
  },
  (t) => [
    index("settlements_broker_id_idx").on(t.brokerId),
    index("settlements_settlement_date_idx").on(t.settlementDate),
  ],
);

export type SettlementRowDb = typeof settlements.$inferSelect;
export type NewSettlementRow = typeof settlements.$inferInsert;

/** Commission import session log. */
export const settlementImports = pgTable(
  "settlement_imports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    importedBy: text("imported_by").notNull(),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull(),
    /** "Upfront: 44, Trail: 311, Clawback: 2" — UI hint. */
    sheetCounts: text("sheet_counts").notNull(),
  },
  (t) => [index("settlement_imports_imported_at_idx").on(t.importedAt)],
);

export type SettlementImportRow = typeof settlementImports.$inferSelect;
export type NewSettlementImport = typeof settlementImports.$inferInsert;

/* -------------------------------------------------------------------------- */
/* settlement_reviews — anniversary review touchpoints                        */
/* -------------------------------------------------------------------------- */

/**
 * Per (settlement, milestone) tracking row. Records whether the CX
 * manager has actioned a particular anniversary touchpoint — sent the
 * email, booked the meeting, or dismissed it as not applicable.
 * Composite key (settlementId, milestone) so we can never have two
 * reviews for the same milestone on the same loan.
 */
export const settlementReviews = pgTable(
  "settlement_reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    settlementId: text("settlement_id").notNull(),
    /** 3 | 6 | 12 | 18 | 24 */
    milestone: integer("milestone").notNull(),
    /** ISO yyyy-mm-dd the milestone fell on. */
    milestoneDate: text("milestone_date").notNull(),

    /** booked | emailed | dismissed */
    state: text("state").notNull(),
    /** Team member who actioned it (e.g. "ceo" for CX officer). */
    actionedBy: text("actioned_by").notNull(),
    /** Free-form note from the broker. */
    note: text("note"),
  },
  (t) => [
    index("settlement_reviews_settlement_idx").on(t.settlementId),
    index("settlement_reviews_milestone_date_idx").on(t.milestoneDate),
  ],
);

export type SettlementReviewRow = typeof settlementReviews.$inferSelect;
export type NewSettlementReview = typeof settlementReviews.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Team permissions - runtime overrides for who gets admin / CX access        */
/* -------------------------------------------------------------------------- */

/**
 * Per-team-member access overrides. When a row exists for a team id
 * here, its booleans replace the hardcoded defaults in
 * lib/auth/permissions.ts. Missing rows fall back to defaults so the
 * table is purely additive - safe to be empty.
 *
 * The Master Admin (Michael, "mm") is always admin + CX regardless of
 * what's in here. That floor prevents the admin from accidentally
 * locking themselves out by toggling their own row.
 */
export const teamPermissions = pgTable("team_permissions", {
  /** TEAM.id (e.g. "mm", "na", "ds", "ceo") OR a team_extras.id. */
  teamId: text("team_id").primaryKey(),
  /** Grants /dashboard/setup, /audit, /dashboard/import, /dashboard/bulk-docs access. */
  isAdmin: boolean("is_admin").default(false).notNull(),
  /** Grants /cx/* access. */
  canAccessCx: boolean("can_access_cx").default(false).notNull(),
  /** When true, dashboard layout redirects this user to /access-revoked
   *  and they cannot reach any /dashboard surface. Master Admin can
   *  never be disabled (auth-gate refuses to write it). */
  disabled: boolean("disabled").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  /** TEAM.id of whoever last toggled this row. */
  updatedBy: text("updated_by").notNull(),
});

export type TeamPermissionRow = typeof teamPermissions.$inferSelect;
export type NewTeamPermission = typeof teamPermissions.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Team extras - team members added at runtime via /dashboard/setup           */
/* -------------------------------------------------------------------------- */

/**
 * Runtime-added team members. The hardcoded TEAM constant in
 * lib/team.ts is the source of truth for the original staff; this
 * table lets Michael add new staff later without a redeploy.
 *
 * ids use the prefix "tex_" so they never collide with the 2-letter
 * TEAM ids ("mm", "na", "ds", etc).
 *
 * Initials / colour are picked when the row is created so the avatar
 * matches everywhere it shows up.
 */
export const teamExtras = pgTable("team_extras", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  short: text("short").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  bookingUrl: text("booking_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  createdBy: text("created_by").notNull(),
});

export type TeamExtraRow = typeof teamExtras.$inferSelect;
export type NewTeamExtra = typeof teamExtras.$inferInsert;

/* -------------------------------------------------------------------------- */
/* referrers — accountants, real-estate agents, planners, etc.                */
/* -------------------------------------------------------------------------- */

/**
 * Referrers who submit leads via the referrer portal (/referrer/[token]).
 * Each row represents one person or firm that has been issued a portal link.
 * The JWT token is stateless; the hash here is for revocation + row lookup.
 *
 * ids use the prefix "ref_" to distinguish from deal ids and team ids.
 */
export const referrers = pgTable(
  "referrers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    company: text("company").notNull().default(""),
    /** accountant | real-estate | planner | other */
    type: text("type").notNull().default("other"),
    /** SHA-256 of the raw JWT — for revocation checks. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    leadsCount: integer("leads_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** TEAM.id of the broker who issued this portal link. */
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("referrers_token_hash_idx").on(t.tokenHash),
    index("referrers_created_by_idx").on(t.createdBy),
    index("referrers_is_active_idx").on(t.isActive),
  ],
);

export type ReferrerRow = typeof referrers.$inferSelect;
export type NewReferrer = typeof referrers.$inferInsert;

/* -------------------------------------------------------------------------- */
/* pipeline_snapshots — daily pipeline counts for week-on-week deltas         */
/* -------------------------------------------------------------------------- */

/**
 * One row per calendar day, written by the snapshot cron. Stores the
 * per-stage (and priority-flag) deal counts so the Pipeline overview can
 * show a real "Previous Week" column and week-on-week change instead of
 * "—". `counts` is keyed by the overview row labels (Mankin stage names
 * plus "Outstanding Action" / "Follow up"), matching lib/overview.ts.
 *
 * snapshot_date (YYYY-MM-DD, local) is unique so the cron is idempotent:
 * re-running it for the same day overwrites rather than duplicates.
 */
export const pipelineSnapshots = pgTable(
  "pipeline_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** Local calendar day, YYYY-MM-DD. */
    snapshotDate: text("snapshot_date").notNull(),
    /** Row-label -> deal count. */
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  },
  (t) => [uniqueIndex("pipeline_snapshots_date_idx").on(t.snapshotDate)],
);

export type PipelineSnapshotRow = typeof pipelineSnapshots.$inferSelect;
export type NewPipelineSnapshot = typeof pipelineSnapshots.$inferInsert;

/* -------------------------------------------------------------------------- */
/* lender_slas — per-lender turnaround times (broker-editable)                */
/* -------------------------------------------------------------------------- */

/**
 * Turnaround expectations per lender (business days), entered by Mankin
 * via the SLA settings editor. Drives follow-up urgency + the "when to
 * expect news" line in customer comms. One row per lender id (from
 * lib/lenders.ts). Null columns mean "not supplied yet".
 */
export const lenderSlas = pgTable("lender_slas", {
  lenderId: text("lender_id").primaryKey(),
  purchaseAssessDays: integer("purchase_assess_days"),
  refinanceAssessDays: integer("refinance_assess_days"),
  preApprovalDays: integer("pre_approval_days"),
  formalDays: integer("formal_days"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedBy: text("updated_by").notNull().default("system"),
});

export type LenderSlaRow = typeof lenderSlas.$inferSelect;
export type NewLenderSla = typeof lenderSlas.$inferInsert;

/* -------------------------------------------------------------------------- */
/* campaigns — bulk marketing emails to the back-book + pipeline              */
/* -------------------------------------------------------------------------- */

/**
 * One marketing send. The broker writes it once; the audience filter
 * decides who it goes to, and campaign_recipients holds the per-person
 * copy of what actually happened.
 *
 * Deliberately NOT the same thing as the one-to-one comms elsewhere in
 * the app (composer drafts, milestone comms, anniversary reviews). Those
 * are relationship emails a broker sends by hand to one customer. A
 * campaign is a single body merged across hundreds of people, which
 * makes it commercial electronic messaging under the Spam Act 2003 —
 * hence the mandatory unsubscribe path and the suppression list below.
 *
 * `audience` holds the AudienceFilter (see lib/campaigns/audience.ts) as
 * JSONB so segments can gain fields without a migration. The audience is
 * resolved to concrete recipients once, at the moment the broker sends —
 * a campaign that goes out on Tuesday should not silently pick up people
 * who settled on Wednesday.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Internal name — never shown to customers. */
    name: text("name").notNull(),
    /** Subject line, merge fields allowed. */
    subject: text("subject").notNull().default(""),
    /** Body in the app's light markup (see lib/campaigns/merge.ts). */
    body: text("body").notNull().default(""),

    /** draft | scheduled | sending | sent | paused | cancelled */
    status: text("status").notNull().default("draft"),

    /** AudienceFilter payload — parsed through Zod on read. */
    audience: jsonb("audience").notNull(),

    /** Team member id whose mailbox the campaign sends from. */
    fromBrokerId: text("from_broker_id").notNull(),
    /** Team member id who created it (may differ from the sender). */
    createdBy: text("created_by").notNull(),

    /** When set and status=scheduled, the cron picks it up at/after this. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** First moment a recipient was dispatched. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Set once every recipient has reached a terminal state. */
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Per-campaign toggle for the open pixel + click wrapping. */
    trackOpens: boolean("track_opens").notNull().default(true),
    trackClicks: boolean("track_clicks").notNull().default(true),

    /* ---- Subject line A/B test ---- */

    /**
     * The rival subject line. Null means no test — one subject, every
     * recipient, which is what most campaigns should be.
     *
     * Only the subject is tested. Testing the body as well would make a
     * result uninterpretable at this list size: with a few hundred
     * recipients there is barely enough signal to separate two subjects,
     * let alone two variables at once.
     */
    subjectB: text("subject_b"),
    /**
     * Share of the audience used to decide, split evenly between the
     * two subjects. The rest are held back for the winner.
     */
    abTestPercent: integer("ab_test_percent").notNull().default(30),
    /** How long to let opens accumulate before calling it. */
    abDecideAfterHours: integer("ab_decide_after_hours").notNull().default(4),
    /** "a" | "b" once decided. */
    abWinner: text("ab_winner"),
    abDecidedAt: timestamp("ab_decided_at", { withTimezone: true }),
  },
  (t) => [
    index("campaigns_status_idx").on(t.status),
    index("campaigns_scheduled_for_idx").on(t.scheduledFor),
    index("campaigns_created_by_idx").on(t.createdBy),
  ],
);

export type CampaignRow = typeof campaigns.$inferSelect;
export type NewCampaignRow = typeof campaigns.$inferInsert;

/* -------------------------------------------------------------------------- */
/* campaign_recipients — the per-person send record                          */
/* -------------------------------------------------------------------------- */

/**
 * One row per person per campaign, written when the audience is resolved
 * and updated as the send progresses. This is both the work queue the
 * cron drains and the evidence trail for "did this customer get it, and
 * did they open it".
 *
 * Unique on (campaign_id, email) so a customer who appears in both the
 * back-book and the live pipeline is only ever mailed once per campaign.
 */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    campaignId: uuid("campaign_id").notNull(),

    /** Lower-cased contact address — the dedupe + suppression key. */
    email: text("email").notNull(),
    /** Display name at resolve time, e.g. "Sarah Chen". */
    name: text("name").notNull().default(""),
    /** First name used for the greeting merge field. */
    firstName: text("first_name").notNull().default(""),

    /** settlement | deal — where this contact came from. */
    sourceKind: text("source_kind").notNull(),
    /** Settlement id or deal id, for drilling back to the record. */
    sourceId: text("source_id").notNull(),
    /** Merge-field values frozen at resolve time (lender, broker, etc). */
    fields: jsonb("fields").$type<Record<string, string>>(),

    /**
     * pending | sent | failed | skipped | holdback
     *
     * "holdback" is the remainder of an A/B test: resolved and frozen
     * like everyone else, but not dispatched until a winning subject is
     * known. They become pending the moment one is.
     */
    status: text("status").notNull().default("pending"),
    /** "a" | "b" for a test recipient; null when there is no test. */
    variant: text("variant"),
    /** Why a recipient was skipped: suppressed | no-email | duplicate. */
    skipReason: text("skip_reason"),
    /** Truncated Graph error for a failed send. */
    error: text("error"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    index("campaign_recipients_campaign_idx").on(t.campaignId),
    index("campaign_recipients_status_idx").on(t.status),
    uniqueIndex("campaign_recipients_campaign_email_idx").on(
      t.campaignId,
      t.email,
    ),
  ],
);

export type CampaignRecipientRow = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;

/* -------------------------------------------------------------------------- */
/* email_suppressions — the do-not-market list                               */
/* -------------------------------------------------------------------------- */

/**
 * Addresses that must never receive a campaign again. Written by the
 * unsubscribe route, and by hand from the campaigns UI when someone asks
 * to be taken off by phone or reply.
 *
 * The Spam Act 2003 gives five working days to honour an unsubscribe; we
 * apply it immediately and check this table at both audience-resolve and
 * send time, because a customer can unsubscribe in the window between
 * the two. Transactional mail (portal nudges, milestone comms, OTPs) is
 * NOT filtered through here — that is service correspondence about a
 * loan the customer asked us to arrange, not marketing.
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    /** Lower-cased address. Primary key — one row per person, forever. */
    email: text("email").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** unsubscribe | manual | bounce */
    reason: text("reason").notNull().default("unsubscribe"),
    /** Campaign that prompted it, when it came from an unsubscribe click. */
    campaignId: uuid("campaign_id"),
    /** Team member id for a manual add; "customer" for a self-unsubscribe. */
    addedBy: text("added_by").notNull().default("customer"),
  },
  (t) => [index("email_suppressions_created_at_idx").on(t.createdAt)],
);

export type EmailSuppressionRow = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;

/* -------------------------------------------------------------------------- */
/* campaign_link_clicks — which link in the email people actually pressed     */
/* -------------------------------------------------------------------------- */

/**
 * Per-URL click counts for a campaign. The recipient row records THAT
 * someone clicked; this records WHAT they clicked, which is the more
 * useful half — a 17% click rate means something different when it is
 * all the booking link versus all the unsubscribe link.
 *
 * Counted rather than logged per event: the report needs totals and a
 * share, and a row per click on a 500-person send buys nothing a counter
 * doesn't. Unique on (campaign, url).
 */
export const campaignLinkClicks = pgTable(
  "campaign_link_clicks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    campaignId: uuid("campaign_id").notNull(),
    /** Destination URL, as it appeared in the body. */
    url: text("url").notNull(),
    clicks: integer("clicks").notNull().default(0),
    firstClickAt: timestamp("first_click_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("campaign_link_clicks_campaign_idx").on(t.campaignId),
    uniqueIndex("campaign_link_clicks_campaign_url_idx").on(t.campaignId, t.url),
  ],
);

export type CampaignLinkClickRow = typeof campaignLinkClicks.$inferSelect;
export type NewCampaignLinkClick = typeof campaignLinkClicks.$inferInsert;

/* -------------------------------------------------------------------------- */
/* automations — the sequence builder                                        */
/* -------------------------------------------------------------------------- */

/**
 * One automated sequence. The whole flow — trigger, nodes and their
 * pointers — lives in `flow` as JSONB, parsed through AutomationFlowSchema
 * on read, so the node model can gain kinds and fields without a
 * migration per change.
 *
 * A campaign is one body sent once to a list a broker chose. An
 * automation is a rule that keeps running: the book decides who enters
 * and when, which is why nobody has to remember to send it.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** draft | live | paused */
    status: text("status").notNull().default("draft"),
    /** AutomationFlow payload. */
    flow: jsonb("flow").notNull(),

    /** Mailbox the sequence sends from. */
    fromBrokerId: text("from_broker_id").notNull(),
    createdBy: text("created_by").notNull(),
    /** First moment it went live — "running since" on the header. */
    activatedAt: timestamp("activated_at", { withTimezone: true }),

    trackOpens: boolean("track_opens").notNull().default(true),
    trackClicks: boolean("track_clicks").notNull().default(true),
  },
  (t) => [
    index("automations_status_idx").on(t.status),
    index("automations_created_by_idx").on(t.createdBy),
  ],
);

export type AutomationRow = typeof automations.$inferSelect;
export type NewAutomationRow = typeof automations.$inferInsert;

/* -------------------------------------------------------------------------- */
/* automation_runs — one contact's journey through one sequence              */
/* -------------------------------------------------------------------------- */

/**
 * A contact's position in a sequence. One row per (automation, email),
 * enforced by a unique index — a person enters a given automation once,
 * ever, and re-entry would mean sending them the same annual review
 * twice.
 *
 * `nextRunAt` is the work queue: the cron picks up runs whose wait has
 * expired. Indexed with status because that pair is the only query the
 * runner makes.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    automationId: uuid("automation_id").notNull(),

    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    /** settlement or deal id this contact entered from. */
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    /** Merge values frozen at entry. */
    fields: jsonb("fields").$type<Record<string, string>>(),

    /** waiting | running | done | exited */
    status: text("status").notNull().default("waiting"),
    /** Node the contact is sitting on. */
    currentNodeId: text("current_node_id").notNull(),
    /** When the contact arrived at that node. A delay is measured from
     *  here, not from nextRunAt — nextRunAt only says when the runner
     *  should next look, and conflating the two makes a delay expire the
     *  moment it is reached. */
    nodeEnteredAt: timestamp("node_entered_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** When the runner should look at this run again. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),

    enteredAt: timestamp("entered_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Set when a flow turns out to be malformed mid-run. */
    error: text("error"),
  },
  (t) => [
    index("automation_runs_automation_idx").on(t.automationId),
    index("automation_runs_due_idx").on(t.status, t.nextRunAt),
    uniqueIndex("automation_runs_automation_email_idx").on(
      t.automationId,
      t.email,
    ),
  ],
);

export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type NewAutomationRun = typeof automationRuns.$inferInsert;

/* -------------------------------------------------------------------------- */
/* automation_sends — what a sequence actually sent, and what came back      */
/* -------------------------------------------------------------------------- */

/**
 * One email sent by one node of one run.
 *
 * Separate from campaign_recipients because the questions differ: a
 * campaign asks "how did this send perform across 400 people", a
 * sequence asks "did THIS person open the email that decides which
 * branch they take". The condition evaluator reads the most recent row
 * here for the run.
 */
export const automationSends = pgTable(
  "automation_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid("run_id").notNull(),
    automationId: uuid("automation_id").notNull(),
    /** Node that produced this send, for the canvas per-node stats. */
    nodeId: text("node_id").notNull(),
    email: text("email").notNull(),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    /** Populated when the send failed; the node counts it as dropped. */
    error: text("error"),
  },
  (t) => [
    index("automation_sends_run_idx").on(t.runId),
    index("automation_sends_automation_node_idx").on(t.automationId, t.nodeId),
  ],
);

export type AutomationSendRow = typeof automationSends.$inferSelect;
export type NewAutomationSend = typeof automationSends.$inferInsert;

/* -------------------------------------------------------------------------- */
/* forms — the acquisition surfaces                                          */
/* -------------------------------------------------------------------------- */

/**
 * A pop-up, embedded form or promotion bar. The layout, fields, copy and
 * destination live in `config` as JSONB, parsed through FormConfigSchema
 * on read.
 *
 * `views` is a counter rather than a row per impression: the only
 * question asked of it is the conversion rate, and a row per page view
 * on a public site is a table that grows forever to answer a division.
 */
export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** popup | embedded | promotion */
    type: text("type").notNull(),
    /** draft | live | paused */
    status: text("status").notNull().default("draft"),
    /** FormConfig payload. */
    config: jsonb("config").notNull(),

    createdBy: text("created_by").notNull(),
    /** Impressions, for the conversion rate. */
    views: integer("views").notNull().default(0),
  },
  (t) => [
    index("forms_status_idx").on(t.status),
    index("forms_type_idx").on(t.type),
  ],
);

export type FormRow = typeof forms.$inferSelect;
export type NewFormRow = typeof forms.$inferInsert;

/* -------------------------------------------------------------------------- */
/* form_submissions — every enquiry, and the deal it became                  */
/* -------------------------------------------------------------------------- */

/**
 * One enquiry. `dealId` is the point of the table: a submission that
 * created a pipeline deal carries its id, so an enquiry can always be
 * traced to the loan it turned into — and one that failed to create a
 * deal is visible as exactly that rather than silently lost.
 */
export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    formId: uuid("form_id").notNull(),
    /**
     * The landing page this enquiry came through, when it came through
     * one. Null for the hosted form at /f/<id> and for the embed on the
     * firm's own site.
     *
     * Without it a page can only report its embedded form's *total*
     * submissions, which counts enquiries that arrived somewhere else
     * entirely — an unpublished page would claim conversions it never
     * saw. Attribution has to be recorded at submit time; it cannot be
     * reconstructed later.
     */
    pageId: uuid("page_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    /** Free-form answers keyed by field id. */
    answers: jsonb("answers").$type<Record<string, string>>(),

    /** Deal created from this enquiry, when the form routes to the
     *  pipeline. Null for a register-only form, or when creation failed. */
    dealId: text("deal_id"),
    /** Why no deal exists, when one was expected. */
    error: text("error"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("form_submissions_form_idx").on(t.formId),
    index("form_submissions_page_idx").on(t.pageId),
    index("form_submissions_submitted_at_idx").on(t.submittedAt),
  ],
);

export type FormSubmissionRow = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;

/* -------------------------------------------------------------------------- */
/* landing_pages — small published pages                                     */
/* -------------------------------------------------------------------------- */

/**
 * A landing page, served at /p/<slug>.
 *
 * The slug is unique and is the page's public identity, so it is a
 * column rather than a field inside the config — the routing layer needs
 * to look a page up by it on every request, and it must be impossible
 * for two pages to claim the same address.
 *
 * `views` is a counter for the same reason forms have one: the only
 * question asked is conversion, and a row per page view is a table that
 * grows forever to answer a division.
 */
export const landingPages = pgTable(
  "landing_pages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** Public path segment, unique across all pages. */
    slug: text("slug").notNull(),
    /** draft | published */
    status: text("status").notNull().default("draft"),
    /** PageConfig payload — blocks and meta. */
    config: jsonb("config").notNull(),

    createdBy: text("created_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    views: integer("views").notNull().default(0),
  },
  (t) => [
    uniqueIndex("landing_pages_slug_idx").on(t.slug),
    index("landing_pages_status_idx").on(t.status),
  ],
);

export type LandingPageRow = typeof landingPages.$inferSelect;
export type NewLandingPage = typeof landingPages.$inferInsert;

/* -------------------------------------------------------------------------- */
/* email_templates — saved campaign bodies                                    */
/* -------------------------------------------------------------------------- */

/**
 * A saved email template.
 *
 * Subject and body live in the config alongside the category and the
 * card description, for the same reason a campaign's audience does: the
 * shape can gain a field without a migration, and every field has a
 * default so old rows keep parsing.
 *
 * The built-in library ships in code (lib/templates/types.ts). Only
 * templates someone here saved land in this table, which is why there
 * is no "built in" flag to filter on.
 */
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** TemplateConfig payload — subject, body, category, description. */
    config: jsonb("config").notNull(),

    createdBy: text("created_by").notNull(),
    /** Bumped whenever a campaign is started from it, so the gallery can
     *  put what the firm actually uses at the front. */
    timesUsed: integer("times_used").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("email_templates_created_at_idx").on(t.createdAt)],
);

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

/* -------------------------------------------------------------------------- */
/* contact_tags — free-form labels on a contact                               */
/* -------------------------------------------------------------------------- */

/**
 * A tag on a contact.
 *
 * Keyed on the email address rather than a contact id, because there is
 * no contacts table to point at: a Mailflow contact is derived from a
 * settlement or a live deal, and the same person can be both. The email
 * is the one identity that survives across sources — the same reason
 * the suppression register is keyed on it.
 *
 * One row per (email, tag). Removing a tag deletes the row rather than
 * flagging it: a tag nobody applies any more should stop appearing in
 * the filter list, and there is nothing worth auditing in the absence
 * of a label.
 */
export const contactTags = pgTable(
  "contact_tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Lower-cased, trimmed. */
    email: text("email").notNull(),
    /** The label itself, as typed. Compared case-insensitively. */
    tag: text("tag").notNull(),
    /** Team member who applied it. */
    addedBy: text("added_by").notNull(),
  },
  (t) => [
    uniqueIndex("contact_tags_email_tag_idx").on(t.email, t.tag),
    index("contact_tags_tag_idx").on(t.tag),
  ],
);

export type ContactTagRow = typeof contactTags.$inferSelect;
export type NewContactTag = typeof contactTags.$inferInsert;

/* -------------------------------------------------------------------------- */
/* audience_segments — a named, reusable audience filter                      */
/* -------------------------------------------------------------------------- */

/**
 * A saved audience filter.
 *
 * The filter, not its members. A segment recalculates every time it is
 * used, so "settled two or more years ago, still on a variable rate"
 * means the same thing in March as it did in January and picks up the
 * people who have since qualified. Freezing membership would turn a
 * segment into a list, and the firm already has one of those.
 *
 * That is also why a campaign copies a segment's filter rather than
 * pointing at it: a campaign's audience is resolved once, at send, and
 * must not shift under a scheduled send because someone edited the
 * segment that afternoon.
 */
export const audienceSegments = pgTable(
  "audience_segments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** One line on what it selects, for the picker. */
    description: text("description").notNull().default(""),
    /** AudienceFilter payload — parsed through Zod on read. */
    filter: jsonb("filter").notNull(),

    createdBy: text("created_by").notNull(),
  },
  (t) => [uniqueIndex("audience_segments_name_idx").on(t.name)],
);

export type AudienceSegmentRow = typeof audienceSegments.$inferSelect;
export type NewAudienceSegment = typeof audienceSegments.$inferInsert;

/* -------------------------------------------------------------------------- */
/* mailflow_settings — one row, the module's own configuration                */
/* -------------------------------------------------------------------------- */

/**
 * Mailflow's settings. Exactly one row, keyed on a fixed id.
 *
 * A single row rather than a key/value table: these settings are read
 * together on every send, and reading one row beats assembling six.
 * The payload is JSONB so a new setting costs no migration, and it is
 * parsed through Zod on read, where every field has a default — an old
 * row keeps working after the shape grows.
 */
export const mailflowSettings = pgTable("mailflow_settings", {
  /** Always SETTINGS_ROW_ID. The primary key is what makes "one row"
   *  a database guarantee rather than a convention. */
  id: text("id").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  /** MailflowSettings payload. */
  settings: jsonb("settings").notNull(),
  /** Who last changed them. */
  updatedBy: text("updated_by").notNull(),
});

/** The only id the settings table ever holds. */
export const SETTINGS_ROW_ID = "mailflow";

export type MailflowSettingsRow = typeof mailflowSettings.$inferSelect;
export type NewMailflowSettings = typeof mailflowSettings.$inferInsert;

/* -------------------------------------------------------------------------- */
/* media_files — images a campaign can use                                    */
/* -------------------------------------------------------------------------- */

/**
 * An uploaded image.
 *
 * The bytes live in Postgres, base64 in a text column, and are served
 * from /api/files/<id>. That is not where a large media library
 * belongs — object storage is — but it is the right call at this size
 * and worth stating why:
 *
 * An image in an email must be fetchable by a mail client with no
 * credentials, from any network, for as long as the email exists in
 * someone's inbox. A SharePoint link is not that; a signed URL is not
 * that either, because it expires while the email does not. So the
 * options were a public object-storage bucket — a new service, a new
 * credential, a new thing to get wrong — or the database already in
 * use. At a few brand images and a 2 MB ceiling, the database wins on
 * every count except purity.
 *
 * The move to object storage becomes worth making when the library
 * runs to hundreds of files or someone uploads video. Until then this
 * has one fewer moving part, and the serve route is the only thing
 * that would need to change.
 */
export const mediaFiles = pgTable(
  "media_files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Original filename, for the broker to recognise it by. */
    name: text("name").notNull(),
    /** Validated against an allow-list on upload — never trusted from
     *  the client, because it becomes a Content-Type response header. */
    contentType: text("content_type").notNull(),
    /** Decoded size in bytes. */
    size: integer("size").notNull(),
    /** Base64 payload. ~33% larger than the file itself. */
    data: text("data").notNull(),

    /**
     * Alt text, for the reader whose client blocks images — which on a
     * cold send is most of them. An image with no alt text is a blank
     * rectangle where the point of the email was.
     */
    altText: text("alt_text").notNull().default(""),

    uploadedBy: text("uploaded_by").notNull(),
  },
  (t) => [index("media_files_created_at_idx").on(t.createdAt)],
);

export type MediaFileRow = typeof mediaFiles.$inferSelect;
export type NewMediaFile = typeof mediaFiles.$inferInsert;

/* -------------------------------------------------------------------------- */
/* surveys — asking a client what they thought                                */
/* -------------------------------------------------------------------------- */

/**
 * A survey. Questions, copy and the thank-you live in `config` as JSONB,
 * parsed through SurveyConfigSchema on read — same shape as forms and
 * landing pages, for the same reason: a question kind can be added
 * without a migration, and every field has a default so old rows keep
 * parsing.
 *
 * `sent` is a counter rather than a join, because the only question
 * asked of it is the response rate, and that is a division.
 */
export const surveys = pgTable(
  "surveys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** draft | live | closed */
    status: text("status").notNull().default("draft"),
    /** SurveyConfig payload. */
    config: jsonb("config").notNull(),

    createdBy: text("created_by").notNull(),
    /** How many invitations have gone out, for the response rate. */
    sent: integer("sent").notNull().default(0),
  },
  (t) => [index("surveys_status_idx").on(t.status)],
);

export type SurveyRow = typeof surveys.$inferSelect;
export type NewSurveyRow = typeof surveys.$inferInsert;

/* -------------------------------------------------------------------------- */
/* survey_responses — one person's answers                                    */
/* -------------------------------------------------------------------------- */

/**
 * One response. Unique on (survey, email): a client answers a given
 * survey once, and a second submission replaces the first rather than
 * counting twice — someone who re-reads the email and answers again has
 * changed their mind, not doubled their opinion.
 *
 * The email is recorded because we already know who we asked. That is
 * the difference between this and a form: a survey invitation carries a
 * signed token naming its recipient, so an answer arrives attributable
 * without anyone being asked to identify themselves. It also means a
 * detractor can be rung up, which is the entire point of asking.
 */
export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    surveyId: uuid("survey_id").notNull(),

    /** Lower-cased address of whoever was asked. */
    email: text("email").notNull(),
    /** Display name at invitation time. */
    name: text("name").notNull().default(""),

    /** SurveyAnswers payload, keyed by question id. */
    answers: jsonb("answers").$type<Record<string, number | string>>().notNull(),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Campaign or automation the invitation came from, when it came
     *  from one. Null for a link sent by hand. */
    sourceKind: text("source_kind"),
    sourceId: text("source_id"),
  },
  (t) => [
    index("survey_responses_survey_idx").on(t.surveyId),
    index("survey_responses_submitted_at_idx").on(t.submittedAt),
    uniqueIndex("survey_responses_survey_email_idx").on(t.surveyId, t.email),
  ],
);

export type SurveyResponseRow = typeof surveyResponses.$inferSelect;
export type NewSurveyResponse = typeof surveyResponses.$inferInsert;

/* -------------------------------------------------------------------------- */
/* webhook_endpoints — where to tell another system what happened             */
/* -------------------------------------------------------------------------- */

/**
 * One receiver. The URL and the events it wants live in `config` as
 * JSONB, parsed on read like every other configurable thing here.
 *
 * `secret` is stored because we need it to sign every delivery, but it
 * is shown to a broker exactly once — at creation — and never read
 * back into the UI. A secret that can be re-read from a settings page
 * is a secret that leaks through whoever can open that page.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    name: text("name").notNull(),
    /** WebhookEndpointConfig payload — url, events, description. */
    config: jsonb("config").notNull(),
    /** HMAC key for the signature header. Never surfaced after create. */
    secret: text("secret").notNull(),

    /** Paused endpoints keep their history but receive nothing. */
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").notNull(),

    /** Last outcome, so the list can show health without a join. */
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    /**
     * Failures in a row. Reset on any success — the number that
     * matters for "is this endpoint dead" is the current streak, not
     * the lifetime total.
     */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  },
  (t) => [index("webhook_endpoints_enabled_idx").on(t.enabled)],
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;

/* -------------------------------------------------------------------------- */
/* webhook_deliveries — the queue, and the record of what happened            */
/* -------------------------------------------------------------------------- */

/**
 * One event bound for one endpoint.
 *
 * Both a work queue and an audit trail, which is why a delivered row
 * is kept rather than dropped: "did the CRM ever hear that this client
 * unsubscribed" is a question worth being able to answer months later,
 * and it is the kind of question that gets asked when somebody
 * complains about still being mailed.
 *
 * `nextAttemptAt` with `status` is the only query the drain makes, so
 * they are indexed together.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    endpointId: uuid("endpoint_id").notNull(),

    event: text("event").notNull(),
    /** The envelope, exactly as it will be serialised and signed. */
    payload: jsonb("payload").notNull(),

    /** pending | delivered | failed | abandoned */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Null once terminal. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    /** Last response, for the log. Null when the request never landed. */
    lastStatus: integer("last_status"),
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_created_at_idx").on(t.createdAt),
  ],
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

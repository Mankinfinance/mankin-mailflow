import { z } from "zod";

/**
 * Salestrekker domain types — the subset our dashboard needs.
 *
 * Source mapping:
 *  - LEADS in dashboard.jsx (lines 43-110) drives Deal/Contact shape
 *  - DOC_CATALOG + DOC_CATALOG_EXTRA in dashboard.jsx drive DocCatalogItem
 *  - STAGES in dashboard.jsx drives Stage union
 *  - Status states match shared.jsx STATUS_META plus advisory variants
 *
 * Zod schemas validate at the API boundary (every external response runs
 * through parse() before being trusted). Inferred TS types are exported
 * alongside for callers.
 */

/**
 * Stage IDs mirror Salestrekker's canonical B.1-B.7 pipeline so the
 * dashboard's Kanban + filters line up with what the team sees in the
 * CRM. Anything pre-B.1 (docs collection, servicing review, lender
 * options) happens *inside* B.1 Pre-Lodgement on Salestrekker — we
 * don't separate it here so a deal's stageId always maps 1:1.
 */
export const StageIdSchema = z.enum([
  "pre-lodge",      // B.1
  "lodged",         // B.2
  "cond-approved",  // B.3a
  "pre-approval",   // B.3b
  "unconditional",  // B.4
  "loan-docs",      // B.5
  "settle-booked",  // B.6
  "settled",        // B.7
]);
export type StageId = z.infer<typeof StageIdSchema>;

/**
 * Phase coarse-groups the 8 stages for KPI tiles + colour coding.
 *  1 = pre-lodgement (B.1)
 *  2 = with lender, lodgement → unconditional (B.2 → B.4)
 *  3 = settling, docs → settled (B.5 → B.7)
 */
export const PhaseSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Phase = z.infer<typeof PhaseSchema>;

export interface StageMeta {
  id: StageId;
  phase: Phase;
  /** Full Salestrekker label (e.g. "B.1 Pre-Lodgement") */
  label: string;
  /** Short label without the B.N prefix, for compact UI */
  shortLabel: string;
  goal: string;
}

export const STAGES: readonly StageMeta[] = [
  { id: "pre-lodge",     phase: 1, label: "B.1 Pre-Lodgement",            shortLabel: "Pre-Lodgement",            goal: "Lodge with the lender" },
  { id: "lodged",        phase: 2, label: "B.2 Lodged",                   shortLabel: "Lodged",                   goal: "Conditional approval" },
  { id: "cond-approved", phase: 2, label: "B.3a Conditionally Approved",  shortLabel: "Conditionally Approved",   goal: "Satisfy conditions" },
  { id: "pre-approval",  phase: 2, label: "B.3b Pre-Approval Only",       shortLabel: "Pre-Approval Only",        goal: "Find a property" },
  { id: "unconditional", phase: 2, label: "B.4 Unconditional",            shortLabel: "Unconditional",            goal: "Issue loan documents" },
  { id: "loan-docs",     phase: 3, label: "B.5 Loan Documents",           shortLabel: "Loan Documents",           goal: "Book settlement" },
  { id: "settle-booked", phase: 3, label: "B.6 Settlement Booked",        shortLabel: "Settlement Booked",        goal: "Settle" },
  { id: "settled",       phase: 3, label: "B.7 Settled",                  shortLabel: "Settled",                  goal: "Post-settlement nurture" },
] as const;

export function stageMeta(id: StageId): StageMeta {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export const DocStatusSchema = z.enum([
  "received",
  "pending",
  "overdue",
  "stale",       // arrived but out of date — advisory note attached
  "incomplete",  // arrived but missing pages — advisory note attached
  "na",
]);
export type DocStatus = z.infer<typeof DocStatusSchema>;

export const DocCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  hint: z.string().optional(),
  /**
   * Which phase the doc unlocks. `pre` = privacy/ID. `assess` = phase 1
   * income/banking docs. `lodge` = phase 2 signed offer / certificate of
   * currency / discharge authority etc.
   */
  stage: z.enum(["pre", "assess", "lodge"]),
  /**
   * When set, the doc is handled outside the portal: typically e-signed
   * via DocuSign and synced into Salestrekker / SharePoint automatically.
   * The customer portal renders this as read-only ("we're handling this
   * for you") and the broker drawer renders a "Tick when signed"
   * checkbox in place of upload affordances.
   */
  external: z
    .object({
      /** Pipeline that delivers the signed doc back to the broker.
       *  e.g. "DocuSign via Salestrekker". */
      via: z.string(),
    })
    .optional(),
  /**
   * When true, the customer self-certifies by ticking a checkbox rather
   * than uploading a file. Used for the privacy form: the customer signs
   * it separately (e.g. via DocuSign in their inbox) and ticks here to
   * confirm. No file upload required.
   */
  selfCertify: z.boolean().optional(),
});
export type DocCatalogItem = z.infer<typeof DocCatalogItemSchema>;

export const AdvisoryNoteSchema = z.object({
  id: z.string(),
  /** which advisory variant to render */
  state: z.enum(["stale", "incomplete"]),
  /** broker-authored note explaining what to redo */
  note: z.string(),
});
export type AdvisoryNote = z.infer<typeof AdvisoryNoteSchema>;

/* -------------------------------------------------------------------------- */
/* Applicants + guarantors                                                    */
/* -------------------------------------------------------------------------- */

/** Living arrangement options captured for portal-added people. Rent and
 *  Board additionally capture a weekly outgoing amount. */
export const LIVING_ARRANGEMENTS = [
  "rent",
  "board",
  "parents",
  "own_mortgage",
  "own_outright",
] as const;
export type LivingArrangement = (typeof LIVING_ARRANGEMENTS)[number];

export const LIVING_ARRANGEMENT_LABEL: Record<LivingArrangement, string> = {
  rent: "Renting",
  board: "Boarding",
  parents: "Living with parents",
  own_mortgage: "Own home (with mortgage)",
  own_outright: "Own home (no mortgage)",
};

/** Extra detail fields captured when a customer adds an applicant or
 *  guarantor through the portal. All optional/defaulted so deals imported
 *  or created before these fields existed still parse. */
const personDetailFields = {
  /** Date of birth as ISO yyyy-mm-dd. Empty when unknown. */
  dob: z.string().default(""),
  /** Residential address, free text. */
  address: z.string().default(""),
  livingArrangement: z.enum(LIVING_ARRANGEMENTS).nullable().default(null),
  /** Weekly rent/board outgoing in AUD; only set for rent/board. */
  weeklyOutgoing: z.number().nullable().default(null),
  /** True when the customer added this person via the portal (vs the
   *  broker adding them in the dashboard). Lets the deal drawer flag it. */
  addedViaPortal: z.boolean().default(false),
};

/** Defaults for the portal-captured person fields. Spread into applicant /
 *  guarantor literals built outside the portal (imports, mock data, the
 *  new-application form) so they satisfy the extended shape without every
 *  call site restating these. Parsed deals get the same values via the
 *  schema defaults. */
export const EMPTY_PERSON_DETAILS: {
  dob: string;
  address: string;
  livingArrangement: LivingArrangement | null;
  weeklyOutgoing: number | null;
  addedViaPortal: boolean;
} = {
  dob: "",
  address: "",
  livingArrangement: null,
  weeklyOutgoing: null,
  addedViaPortal: false,
};

/* -------------------------------------------------------------------------- */
/* Deal                                                                       */
/* -------------------------------------------------------------------------- */

export const DealSchema = z.object({
  id: z.string(),
  appRef: z.string(),              // MF-NNNN
  name: z.string(),                // "Sarah & Tom Reilly"
  email: z.string().email().or(z.literal("")),
  /**
   * Optional second contact email for a combined "A & B" applicant
   * (a couple entered as one applicant). CC'd on every customer email
   * so both partners stay in the loop. Empty string when not set.
   * Deals with two separate applicant records instead carry the
   * co-borrower's address on applicants[1].email — customerEmailRecipients
   * gathers from both.
   */
  secondaryEmail: z.string().email().or(z.literal("")).default(""),
  phone: z.string(),               // free-form for now, AU normalisation later

  stageId: StageIdSchema,
  daysSinceContact: z.number().int().nonnegative(),
  /** ISO timestamp of when the broker last contacted this customer.
   *  Null for deals imported before this field existed. When set,
   *  daysSinceContact is re-computed from this at retrieval time so
   *  the counter advances automatically without a manual update. */
  lastContactAt: z.coerce.date().nullable().optional(),
  /** ISO timestamp of when the deal last moved stage.
   *  Set on every moveDealStage call and on new deal creation.
   *  Null for deals imported before this field existed. Used to
   *  detect stage staleness independently of contact cadence. */
  stageEnteredAt: z.coerce.date().nullable().optional(),
  lender: z.string(),              // "Westpac (proposed)" or "TBC"
  settlement: z.string(),          // "14 Jul" | "TBD"
  avatar: z.string(),              // CSS hex colour — placeholder until photos

  brokerId: z.string(),            // ref → TeamMember.id
  associateId: z.string(),

  received: z.array(z.string()),
  pending: z.array(z.string()),
  overdue: z.array(z.string()),
  advisory: z.array(AdvisoryNoteSchema).default([]),
  /**
   * Doc ids the broker has marked Not Applicable. The customer never sees
   * these on their portal; the dashboard renders them in a collapsible
   * "Not applicable" section that's undoable.
   */
  excluded: z.array(z.string()).default([]),
  /**
   * Broker-added docs that aren't in the rule-engine catalog
   * (e.g. "Letter from accountant explaining gift deposit").
   * Each custom doc's id is also referenced by pending/overdue/received
   * just like a catalog doc, so the same upload flow handles it.
   */
  customDocs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        hint: z.string().optional(),
        cat: z.string().optional(),
      }),
    )
    .default([]),
  /**
   * Loan amount in AUD (whole dollars). Populated once the lender confirms
   * conditional approval. Drives the "Settling this month" KPI and reports.
   */
  loanAmount: z.number().int().nonnegative().nullable().default(null),
  /**
   * ISO date when the loan settled. null until `stageId === 'settled'`.
   * Powers settlement KPIs + Mailerlite's 12-month anniversary trigger.
   */
  settledOn: z.string().nullable().default(null),
  /**
   * ISO date (yyyy-mm-dd) when the lender granted pre-approval.
   * null until the broker records it.
   */
  preApprovalDate: z.string().nullable().default(null),
  /**
   * ISO date (yyyy-mm-dd) when the pre-approval expires.
   * Auto-set to approvalDate + 3 months when the broker records the
   * approval date; can be overridden (some lenders grant 6 months).
   */
  preApprovalExpiry: z.string().nullable().default(null),
  /**
   * When true, the deal is opted out of the daily 4pm end-of-day brief
   * generation. Used for customers who've asked to slow comms (e.g.
   * "we'll come back to you in 3 months") or where the broker is
   * handling comms manually.
   */
  excludeFromDailyUpdates: z.boolean().default(false),
  /**
   * Loan purpose. Drives the conveyancer card (purchases only) and the
   * stamp-duty calculator (when wired). Refinances skip both. "unknown"
   * is the default until the broker confirms.
   */
  purpose: z.enum(["purchase", "refinance", "unknown"]).default("unknown"),
  /**
   * Conveyancer / solicitor handling the property side of a purchase.
   * Captured once the broker has the contract of sale so settlement
   * comms (Power Automate flow 06 "Booking settlement") have somewhere
   * to send. Always null on refinances.
   */
  conveyancer: z
    .object({
      name: z.string(),
      firm: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .nullable()
    .default(null),
  /**
   * When set, the deal has been parked in the nurture list. Nurtured
   * deals are excluded from the main pipeline, capacity, today queue,
   * EOD briefs, forecast, and reports KPIs. They surface only on
   * /dashboard/nurture until the broker explicitly returns them to
   * active. ISO 8601 timestamp of when nurture started, or null while
   * the deal is active.
   */
  nurturedAt: z.string().nullable().default(null),
  /**
   * Free-form reason captured at nurture-time. e.g. "Customer paused —
   * back in October", "Waiting on building inspection at new build".
   * Reviewed alongside the deal on the nurture page so the broker can
   * decide whether to re-engage. Null when not nurtured.
   */
  nurtureReason: z.string().nullable().default(null),
  /**
   * Mankin's existing pipeline spreadsheet uses a richer set of fields
   * than the base B.1-B.7 model. These additive fields keep the
   * dashboard, the Referral Register, and the Excel import contract
   * aligned with the spreadsheet so it can be a drop-in replacement.
   */
  leadCategory: z
    .enum([
      "purchase",
      "refinance",
      "business",
      "asset",
      "smsf",
      "construction",
      "settled",
      "unknown",
    ])
    .default("unknown"),
  /** Lead origin / referral channel (Personal, Referral, Carbone, BNI,
   *  LJ Hooker, Sigma, IW, Fincare, etc.). Free-form so the Mankin
   *  source list can grow without a code change. */
  leadSource: z.string().default(""),
  /** Display label matching the Mankin pipeline sheet's Stage column
   *  exactly (Awaiting Documents, Workshopping, Awaiting AOL, Lodged,
   *  Conditional Approval, Formal Approval, Awaiting Settlement,
   *  Settled). Maps to stageId for the internal B.1-B.7 model. */
  mankinStage: z.string().default(""),
  /** Cross-cutting TODO flag. Outstanding Action and Follow up from
   *  the Mankin sheet aren't really stages — they're surfaces in the
   *  Today queue priority bands while the deal sits in its real stage. */
  priorityFlag: z
    .enum(["outstanding-action", "follow-up"])
    .nullable()
    .default(null),
  /** Free-form notes column from the Mankin pipeline sheet. */
  comments: z.string().nullable().default(null),
  /** Origination month/year label from the pipeline sheet (e.g.
   *  "March 2026"). Captured on import for the deal tracker. Optional so
   *  existing deals + literals don't need to supply it. */
  originatedLabel: z.string().optional(),
  /** Fixed calendar date (yyyy-mm-dd) the application was first added to
   *  LoanFlow. Set once at creation and never overwritten by later edits,
   *  so the deal tracker's "Date added" column stays stable. New
   *  applications stamp the day they're created; imported deals derive it
   *  from the origination month. Absent (undefined) on deals created before
   *  the field existed until the backfill migration (drizzle/0011) runs.
   *  Optional + nullable so existing deal literals and older jsonb payloads
   *  parse cleanly without supplying it. */
  systemAddedAt: z.string().nullable().optional(),
  /** Referral Register fields: who introduced the deal, whether the
   *  giftcard has been sent, and the commission earned (number, AUD). */
  referrer: z.string().nullable().default(null),
  /** UUID of the referrers table row — set when the lead came via the referrer portal. */
  referrerId: z.string().nullable().default(null),
  giftcardSent: z.boolean().default(false),
  commission: z.number().nullable().default(null),
  /**
   * SharePoint web URL of this deal's document folder ("Deal
   * applications/<folder>"). Captured automatically the first time a
   * document is uploaded — the folder is created then — so the broker can
   * jump straight to the file store from the deal. Optional: absent on
   * deals with no uploads yet, and on older records.
   */
  sharepointUrl: z.string().nullable().optional(),
  /**
   * BreezeDoc document id for the in-portal privacy-form e-sign, set when
   * the customer starts signing. Lets the portal poll status and the
   * webhook reconcile completion. Optional: absent until signing starts.
   */
  privacyEsignDocId: z.number().nullable().optional(),
  /**
   * Co-applicants on the deal. The first applicant mirrors the
   * top-level name/email/phone fields. Subsequent applicants are
   * additional borrowers — a joint application would have two, etc.
   * Capped at 4 in the new-application UI. Default [] keeps existing
   * imports compatible.
   */
  applicants: z
    .array(
      z.object({
        name: z.string(),
        email: z.string().default(""),
        phone: z.string().default(""),
        ...personDetailFields,
      }),
    )
    .default([]),
  /**
   * Guarantors on the deal, capped at 2. Optional relationship field
   * captures how the guarantor relates to the applicants
   * (parent, sibling, spouse, friend, ...).
   */
  guarantors: z
    .array(
      z.object({
        name: z.string(),
        email: z.string().default(""),
        phone: z.string().default(""),
        relationship: z.string().nullable().default(null),
        ...personDetailFields,
      }),
    )
    .default([]),
});
export type Deal = z.infer<typeof DealSchema>;
export type DealApplicant = Deal["applicants"][number];
export type DealGuarantor = Deal["guarantors"][number];

/* -------------------------------------------------------------------------- */
/* Helpers — active / nurture / settled filters                                */
/* -------------------------------------------------------------------------- */

/** True when the deal is in active follow-up: not nurtured and not settled.
 *  Used by the main pipeline, capacity calculator, today queue, EOD briefs,
 *  and forecast. */
export function isActiveDeal(deal: Deal): boolean {
  return deal.nurturedAt === null && deal.stageId !== "settled";
}

/** True when the deal has been parked in the nurture list. */
export function isNurturedDeal(deal: Deal): boolean {
  return deal.nurturedAt !== null;
}

/** True when the deal has settled (B.7). Settled and nurtured are
 *  mutually exclusive — settling clears nurturedAt automatically. */
export function isSettledDeal(deal: Deal): boolean {
  return deal.stageId === "settled";
}

/* -------------------------------------------------------------------------- */
/* Mankin pipeline stages                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Mankin's existing pipeline sheet uses these stage labels rather than
 * the canonical B.1-B.7 ids. The dashboard and Excel import keep both
 * in sync: every deal carries a `mankinStage` for display + a `stageId`
 * for internal logic.
 */
export const MANKIN_STAGES = [
  "Awaiting Documents",
  "Workshopping",
  "Awaiting AOL",
  "Lodged",
  "Conditional Approval",
  "Formal Approval",
  "Awaiting Settlement",
  "Settled",
] as const;

export type MankinStage = (typeof MANKIN_STAGES)[number];

/** Many-to-one map from Mankin pipeline labels onto the canonical
 *  B.1-B.7 stage ids. Used by the Excel import + display fallback. */
export const STAGE_FROM_MANKIN: Record<MankinStage, StageId> = {
  "Awaiting Documents": "pre-lodge",
  "Workshopping": "pre-lodge",
  "Awaiting AOL": "pre-lodge",
  "Lodged": "lodged",
  "Conditional Approval": "cond-approved",
  "Formal Approval": "unconditional",
  "Awaiting Settlement": "settle-booked",
  "Settled": "settled",
};

/** One-to-one map from canonical B.1-B.7 ids to a Mankin label.
 *  Used to populate mankinStage when the data only has stageId. */
export const MANKIN_FROM_STAGE: Record<StageId, MankinStage> = {
  "pre-lodge": "Workshopping",
  "lodged": "Lodged",
  "cond-approved": "Conditional Approval",
  "pre-approval": "Conditional Approval",
  "unconditional": "Formal Approval",
  "loan-docs": "Formal Approval",
  "settle-booked": "Awaiting Settlement",
  "settled": "Settled",
};

/** Resolve the best display label for a deal — preferring its captured
 *  mankinStage value, falling back to the mapped label from stageId. */
export function mankinStageLabel(deal: Deal): MankinStage {
  if (deal.mankinStage && (MANKIN_STAGES as readonly string[]).includes(deal.mankinStage)) {
    return deal.mankinStage as MankinStage;
  }
  return MANKIN_FROM_STAGE[deal.stageId] ?? "Workshopping";
}
export type Conveyancer = NonNullable<Deal["conveyancer"]>;

/* -------------------------------------------------------------------------- */
/* Notes / timeline                                                           */
/* -------------------------------------------------------------------------- */

export const TimelineEntrySchema = z.object({
  id: z.string(),
  dealId: z.string(),
  kind: z.enum(["email_sent", "sms_sent", "note", "doc_received", "chat_log", "stage_change"]),
  brokerId: z.string().optional(),
  body: z.string(),
  createdAt: z.string(),           // ISO 8601
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

/* -------------------------------------------------------------------------- */
/* Convenience derivations the dashboard needs                                */
/* -------------------------------------------------------------------------- */

export function totalDocs(deal: Deal): number {
  return deal.received.length + deal.pending.length + deal.overdue.length;
}

export function progressPct(deal: Deal): number {
  const total = totalDocs(deal);
  if (total === 0) return 0;
  return Math.round((deal.received.length / total) * 100);
}

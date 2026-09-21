import "server-only";
import * as XLSX from "xlsx";
import type { Deal, StageId, MankinStage } from "./clients/salestrekker/types";
import {
  STAGES,
  MANKIN_STAGES,
  MANKIN_FROM_STAGE,
  STAGE_FROM_MANKIN,
  EMPTY_PERSON_DETAILS,
} from "./clients/salestrekker/types";
import { TEAM } from "./team";

/**
 * Parse + validate an Excel or CSV file containing Mankin deals.
 *
 * Designed to be a drop-in upload for Mankin's existing Pipeline
 * Dashboard.xlsb without any column renaming. Header matching is
 * case-insensitive and tolerates spaces, dashes, and underscores; the
 * alias table below also maps the broker's natural-language headers
 * ("Client Name", "Deal Owner", "Stage", etc.) onto canonical keys.
 *
 * The ONLY required column is `name`. Everything else is optional with
 * a sensible default applied at parse time:
 *
 *  - app_ref:     auto-generated as "MF-IMP-<rowIndex>" when missing
 *  - email:       defaults to ""; invalid values flag a per-row error
 *  - phone:       defaults to ""
 *  - stage:       defaults to "pre-lodge" (Mankin stage "Workshopping")
 *  - lender:      defaults to "TBC"
 *  - settlement:  defaults to "TBD"
 *  - broker_id:   defaults to the importing broker
 *  - associate_id: defaults to "" (unassigned — only set if the column is present)
 *  - loan_amount: optional number
 *  - settled_on:  optional ISO date
 *  - purpose:     defaults to "unknown"
 *  - nurtured:    defaults to false
 *
 * Returns a structured result the UI can render as a preview table.
 */

export interface ParsedRow {
  /** 1-based source-file row number for the broker to find the issue. */
  sourceRow: number;
  deal?: Deal;
  errors: string[];
}

export interface ParseResult {
  totalRows: number;
  validDeals: Deal[];
  rows: ParsedRow[];
  /** Header columns the file actually contained, normalised. */
  headersFound: string[];
  /** Headers the parser expected but didn't find — empty when all
   *  required columns were present. */
  missingHeaders: string[];
}

/** Only "name" is required; the import auto-fills everything else. */
const REQUIRED_HEADERS = ["name"];

/** Alias table mapping the natural-language headers from the Mankin
 *  Pipeline Dashboard.xlsb onto the canonical keys used by rowToDeal. */
const HEADER_ALIASES: Record<string, string> = {
  // identifiers
  client_name: "name",
  customer_name: "name",
  customer: "name",
  applicant: "name",
  application_ref: "app_ref",
  application_reference: "app_ref",
  ref: "app_ref",
  app_no: "app_ref",
  appref: "app_ref",
  // contact — applicant 1
  email_1: "email",
  email1: "email",
  email_address: "email",
  e_mail: "email",
  phone_1: "phone",
  phone1: "phone",
  phone_number: "phone",
  mobile: "phone",
  mobile_number: "phone",
  contact_number: "phone",
  // contact — applicant 2 (joint applications)
  email_2: "email2",
  email2: "email2",
  second_email: "email2",
  phone_2: "phone2",
  phone2: "phone2",
  mobile_2: "phone2",
  mobile_number_2: "phone2",
  phone_number_2: "phone2",
  contact_number_2: "phone2",
  // ownership
  deal_owner: "broker_id",
  owner: "broker_id",
  broker: "broker_id",
  loan_writer: "broker_id",
  brokerid: "broker_id",
  initials: "broker_id",
  broker_initials: "broker_id",
  staff_initials: "broker_id",
  writer_initials: "broker_id",
  broker_code: "broker_id",
  associate: "associate_id",
  loan_associate: "associate_id",
  loan_support: "associate_id",
  // pipeline
  loan_amount: "loan_amount",
  loan_size: "loan_amount",
  amount: "loan_amount",
  loan_value: "loan_amount",
  // origination month / year (deal tracker "Started" column)
  month: "month",
  origination_month: "month",
  start_month: "month",
  year: "year",
  origination_year: "year",
  start_year: "year",
  lead_category: "lead_category",
  category: "lead_category",
  type: "lead_category",
  loan_type: "lead_category",
  // origin
  source: "lead_source",
  lead_source: "lead_source",
  referral_source: "lead_source",
  origin: "lead_source",
  // stage + status
  stage: "stage",
  status: "stage",
  pipeline_stage: "stage",
  current_stage: "stage",
  // dates
  settled_date: "settled_on",
  settlement_date: "settled_on",
  settled_on: "settled_on",
  // notes
  comments: "comments",
  notes: "comments",
  // referral register
  referrer: "referrer",
  introducer: "referrer",
  gift_card: "giftcard",
  giftcard_sent: "giftcard",
  gift_card_sent: "giftcard",
  commission: "commission",
};

const VALID_STAGE_IDS = new Set<StageId>(STAGES.map((s) => s.id));
const MANKIN_STAGE_SET = new Set<MankinStage>(MANKIN_STAGES);

/** Lowercase + collapse whitespace + replace dashes with underscores
 *  AND apply the alias table so "Client Name" → "name". */
function normaliseHeader(raw: string): string {
  const base = String(raw)
    .toLowerCase()
    .trim()
    .replace(/[\s\-/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return HEADER_ALIASES[base] ?? base;
}

function isYes(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  }
  return false;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n =
    typeof v === "number" ? v : Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Owner-name resolution. Accepts a team member id ("michael"), a short
 *  name ("Michael"), or a full name ("Michael Mankin"). Falls back to
 *  the default broker id when nothing matches. */
function resolveBrokerId(raw: string, defaultBrokerId: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return defaultBrokerId;

  // Exact id match (case-insensitive).
  const lower = trimmed.toLowerCase();
  const byId = TEAM.find((m) => m.id.toLowerCase() === lower);
  if (byId) return byId.id;

  // Short-name match.
  const byShort = TEAM.find((m) => m.short.toLowerCase() === lower);
  if (byShort) return byShort.id;

  // Full-name match (e.g., "Michael Mankin").
  const byFull = TEAM.find((m) => m.name.toLowerCase() === lower);
  if (byFull) return byFull.id;

  // Initials match (e.g., "MM" → Michael Mankin, "RL" → Robert Lombardo).
  const byInitials = TEAM.find((m) => m.initials.toLowerCase() === lower);
  if (byInitials) return byInitials.id;

  // First-name only (most spreadsheets just write "Michael").
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstWord) {
    const byFirst = TEAM.find(
      (m) =>
        m.name.toLowerCase().startsWith(firstWord) ||
        m.short.toLowerCase() === firstWord,
    );
    if (byFirst) return byFirst.id;
  }

  // Special-cases for Mankin's existing labels.
  if (lower === "nurture") return defaultBrokerId; // Nurture isn't a person
  if (lower === "loan support") return defaultBrokerId;

  return defaultBrokerId;
}

/** Stage resolution. Accepts either the canonical id ("pre-lodge",
 *  "lodged", ...) or a Mankin label ("Workshopping", "Awaiting AOL",
 *  "Conditional Approval", ...). Falls back to "pre-lodge". Returns
 *  both the stageId and the resolved mankinStage label. */
function resolveStage(raw: string): { stageId: StageId; mankinStage: MankinStage } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { stageId: "pre-lodge", mankinStage: MANKIN_FROM_STAGE["pre-lodge"] };
  }

  // Canonical id?
  if (VALID_STAGE_IDS.has(trimmed as StageId)) {
    const stageId = trimmed as StageId;
    return { stageId, mankinStage: MANKIN_FROM_STAGE[stageId] };
  }

  // Mankin label? Match case-insensitively against MANKIN_STAGES.
  const lowered = trimmed.toLowerCase();
  const match = MANKIN_STAGES.find((s) => s.toLowerCase() === lowered);
  if (match && MANKIN_STAGE_SET.has(match)) {
    return { stageId: STAGE_FROM_MANKIN[match], mankinStage: match };
  }

  // Common variants that aren't a literal match.
  const variantMap: Record<string, MankinStage> = {
    "settle": "Awaiting Settlement",
    "settling": "Awaiting Settlement",
    "approved": "Formal Approval",
    "unconditional": "Formal Approval",
    "cond approved": "Conditional Approval",
    "conditional": "Conditional Approval",
    "pre approval": "Conditional Approval",
    "pre-approval": "Conditional Approval",
    "lodge": "Lodged",
    "follow up": "Workshopping",
    "follow-up": "Workshopping",
    "followup": "Workshopping",
    "outstanding action": "Workshopping",
    "workshop": "Workshopping",
    "awaiting docs": "Awaiting Documents",
    "awaiting documents": "Awaiting Documents",
    "awaiting aol": "Awaiting AOL",
    /* Loose top-of-funnel labels that brokers sometimes use in their
       spreadsheets. Map to the earliest sensible bucket so the deal
       lands somewhere actionable rather than defaulting to pre-lodge
       with no Mankin label. */
    "source": "Awaiting Documents",
    "check": "Workshopping",
    "new lead": "Awaiting Documents",
    "new": "Awaiting Documents",
    "lead": "Awaiting Documents",
  };
  if (variantMap[lowered]) {
    const ms = variantMap[lowered];
    return { stageId: STAGE_FROM_MANKIN[ms], mankinStage: ms };
  }

  // Default fallback.
  return { stageId: "pre-lodge", mankinStage: MANKIN_FROM_STAGE["pre-lodge"] };
}

/** Lead category resolution. Accepts the canonical enum or the broker's
 *  loose labels (Purchase / Refinance / Refi / SMSF / Construction /
 *  Business / Asset). Falls back to "unknown". */
function resolveLeadCategory(raw: string): Deal["leadCategory"] {
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "purchase" || s === "buy") return "purchase";
  if (s === "refinance" || s === "refi" || s === "refin") return "refinance";
  if (s === "smsf") return "smsf";
  if (s === "construction" || s === "build") return "construction";
  if (s === "business" || s === "commercial") return "business";
  if (s === "asset" || s === "asset finance") return "asset";
  if (s === "settled") return "settled";
  return "unknown";
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Fixed "date added" for an imported row, derived from its origination
 *  month + year → the first of that month (e.g. "March" + "2026" →
 *  "2026-03-01"). Deriving from the sheet rather than the clock keeps the
 *  date stable across re-imports. Accepts month names ("March", "Mar") or
 *  numbers ("3", "03"). Returns null when the sheet has no usable month. */
function deriveSystemAddedAt(monthRaw: string, yearRaw: string): string | null {
  const year = parseInt(yearRaw, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 3000) return null;
  const numeric = parseInt(monthRaw, 10);
  const month =
    Number.isFinite(numeric) && numeric >= 1 && numeric <= 12
      ? numeric
      : (MONTH_INDEX[monthRaw.trim().slice(0, 3).toLowerCase()] ?? 0);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Parse the uploaded file (XLSX or CSV) into raw rows. */
export function parseFileBuffer(args: {
  buffer: ArrayBuffer;
  filename: string;
}): { headers: string[]; rows: Record<string, unknown>[] } {
  const isCsv = args.filename.toLowerCase().endsWith(".csv");
  const wb = XLSX.read(args.buffer, {
    type: "array",
    raw: false,
    cellDates: true,
    ...(isCsv ? { codepage: 65001 } : {}),
  });
  // Pick the first non-hidden sheet; fall back to first sheet.
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: "",
  });
  const headers =
    json.length > 0 ? Object.keys(json[0]).map(normaliseHeader) : [];
  const rows = json.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normaliseHeader(k)] = v;
    }
    return out;
  });
  return { headers, rows };
}

/**
 * Validate a single normalised row into a Deal. Pushes any issues onto
 * the row's error list. Returns the deal when valid.
 */
function rowToDeal(args: {
  row: Record<string, unknown>;
  sourceRow: number;
  defaultBrokerId: string;
}): ParsedRow {
  const errors: string[] = [];
  const r = args.row;

  const name = asString(r.name);
  if (!name) errors.push("Missing name");

  // Auto-generate app_ref if missing; the broker's sheet often doesn't
  // include one.
  const rawAppRef = asString(r.app_ref);
  const appRef = rawAppRef || `MF-IMP-${args.sourceRow}`;

  // Optional contact details — applicant 1.
  const email = asString(r.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(`Invalid email: ${email}`);
  }
  const phone = asString(r.phone);

  // Optional contact details — applicant 2 (joint applications).
  const email2 = asString(r.email2);
  if (email2 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email2)) {
    errors.push(`Invalid email 2: ${email2}`);
  }
  const phone2 = asString(r.phone2);

  // Stage resolution (canonical id OR Mankin label OR variants OR default).
  const rawStage = asString(r.stage);
  const { stageId, mankinStage } = resolveStage(rawStage);

  const lender = asString(r.lender) || "TBC";
  const settlement = asString(r.settlement) || "TBD";
  const brokerId = resolveBrokerId(asString(r.broker_id), args.defaultBrokerId);
  const associateId = asString(r.associate_id);
  const daysSinceContact = Math.max(0, asNumber(r.days_since_contact) ?? 0);
  const loanAmount = asNumber(r.loan_amount);
  const settledOn = asString(r.settled_on) || null;
  const preApprovalDate = asString(r.pre_approval_date) || null;
  const preApprovalExpiry = asString(r.pre_approval_expiry) || null;

  const purposeRaw = asString(r.purpose).toLowerCase();
  const purpose: Deal["purpose"] =
    purposeRaw === "purchase" || purposeRaw === "refinance"
      ? purposeRaw
      : "unknown";

  const leadCategory = resolveLeadCategory(asString(r.lead_category));
  const leadSource = asString(r.lead_source);
  const comments = asString(r.comments) || null;
  const originatedLabel =
    [asString(r.month), asString(r.year)].filter(Boolean).join(" ") || undefined;
  const systemAddedAt = deriveSystemAddedAt(asString(r.month), asString(r.year));

  // Referral Register fields.
  const referrer = asString(r.referrer) || null;
  const giftcardSent = isYes(r.giftcard);
  const commission = asNumber(r.commission);

  const nurtured = isYes(r.nurtured);
  const nurtureReason = asString(r.nurture_reason) || null;

  // id keyed on the resolved appRef so re-imports replace cleanly.
  const id = `imp-${appRef.replace(/[^a-z0-9]/gi, "").toLowerCase() || `row${args.sourceRow}`}`;

  if (errors.length > 0) {
    return { sourceRow: args.sourceRow, errors };
  }

  const deal: Deal = {
    id,
    appRef,
    name,
    email,
    // Imports route a second Email 2 to applicants[1] (below), which the
    // CC helper already picks up — so the standalone second-email field
    // stays empty here. It's set from the drawer / portal instead.
    secondaryEmail: "",
    phone,
    stageId,
    daysSinceContact: Math.round(daysSinceContact),
    lastContactAt: new Date(Date.now() - Math.round(daysSinceContact) * 86_400_000),
    lender,
    settlement,
    avatar: "#9fb1cf",
    brokerId,
    associateId,
    received: [],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    loanAmount: loanAmount !== null ? Math.round(loanAmount) : null,
    settledOn,
    preApprovalDate,
    preApprovalExpiry,
    excludeFromDailyUpdates: false,
    purpose,
    conveyancer: null,
    nurturedAt: nurtured ? new Date().toISOString() : null,
    nurtureReason: nurtured ? nurtureReason : null,
    leadCategory,
    leadSource,
    mankinStage,
    priorityFlag: null,
    comments,
    originatedLabel,
    systemAddedAt,
    referrer,
    referrerId: null,
    giftcardSent,
    commission: commission !== null ? Math.round(commission) : null,
    applicants: name
      ? [
          { ...EMPTY_PERSON_DETAILS, name, email, phone },
          // Second applicant row when the CSV includes Email 2 / Phone 2.
          ...(email2 || phone2
            ? [{ ...EMPTY_PERSON_DETAILS, name: "", email: email2, phone: phone2 }]
            : []),
        ]
      : [],
    guarantors: [],
  };

  return { sourceRow: args.sourceRow, deal, errors: [] };
}

/**
 * End-to-end: take an uploaded file buffer, return a structured parse
 * result the UI can render as a preview table.
 */
export function parseImportedDeals(args: {
  buffer: ArrayBuffer;
  filename: string;
  defaultBrokerId: string;
}): ParseResult {
  const { headers, rows } = parseFileBuffer({
    buffer: args.buffer,
    filename: args.filename,
  });

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));

  if (missingHeaders.length > 0) {
    return {
      totalRows: rows.length,
      validDeals: [],
      rows: [],
      headersFound: headers,
      missingHeaders,
    };
  }

  const parsedRows: ParsedRow[] = rows.map((row, i) =>
    rowToDeal({
      row,
      sourceRow: i + 2, // +1 for 0-index, +1 for header row
      defaultBrokerId: args.defaultBrokerId,
    }),
  );

  return {
    totalRows: rows.length,
    validDeals: parsedRows.filter((r) => r.deal).map((r) => r.deal!),
    rows: parsedRows,
    headersFound: headers,
    missingHeaders: [],
  };
}

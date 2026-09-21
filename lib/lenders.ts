/**
 * Lender catalogue for the dashboard's lender picker.
 *
 * Edge-safe: no server imports, no DB calls. Used from both server
 * (validation) and client (picker dropdown).
 *
 * Each lender has a stable id (kebab-case, used in URLs + Salestrekker
 * sync) and a display name. Status flows separately on the deal:
 *   • "<lender>"                set, no status modifier
 *   • "<lender> (proposed)"     broker has flagged but customer hasn't chosen
 *   • "<lender> (chosen)"       customer locked in
 * The status modifier is appended at write time by formatLenderForDeal.
 */

export type LenderStatus = "tbc" | "comparing" | "proposed" | "chosen";

export interface Lender {
  id: string;
  name: string;
  /** "Big 4" | "Major" | "Non-bank" | "Specialist". Used to group the picker. */
  tier: "Big 4" | "Major" | "Non-bank" | "Specialist";
}

export const LENDERS: Lender[] = [
  /* Big 4 */
  { id: "anz",      name: "ANZ",            tier: "Big 4" },
  { id: "cba",      name: "Commonwealth Bank", tier: "Big 4" },
  { id: "nab",      name: "NAB",            tier: "Big 4" },
  { id: "westpac",  name: "Westpac",        tier: "Big 4" },

  /* Major banks */
  { id: "macquarie",        name: "Macquarie",            tier: "Major" },
  { id: "ing",              name: "ING",                  tier: "Major" },
  { id: "suncorp",          name: "Suncorp Bank",         tier: "Major" },
  { id: "bankwest",         name: "Bankwest",             tier: "Major" },
  { id: "st-george",        name: "St.George",            tier: "Major" },
  { id: "me-bank",          name: "ME Bank",              tier: "Major" },
  { id: "amp",              name: "AMP",                  tier: "Major" },
  { id: "mystate",          name: "MyState Bank",         tier: "Major" },
  { id: "bendigo",          name: "Bendigo Bank",         tier: "Major" },
  { id: "bank-australia",   name: "Bank Australia",       tier: "Major" },
  { id: "newcastle",        name: "Newcastle Permanent",  tier: "Major" },
  { id: "great-southern",   name: "Great Southern Bank",  tier: "Major" },
  { id: "bank-of-sydney",   name: "Bank of Sydney",       tier: "Major" },

  /* Non-bank lenders */
  { id: "resimac",          name: "Resimac",              tier: "Non-bank" },
  { id: "ubank",            name: "Ubank",                tier: "Non-bank" },
  { id: "firstmac",         name: "Firstmac",             tier: "Non-bank" },
  { id: "finsecure",        name: "Finsecure",            tier: "Non-bank" },
  { id: "rate-money",       name: "Rate Money",           tier: "Non-bank" },
  { id: "resi",             name: "Resi",                 tier: "Non-bank" },
  { id: "brighten",         name: "Brighten",             tier: "Non-bank" },
  { id: "ma-money",         name: "MA Money",             tier: "Non-bank" },
  { id: "orde",             name: "ORDE Financial",       tier: "Non-bank" },
  { id: "people-first",     name: "People First Bank",    tier: "Non-bank" },

  /* Specialist (non-conforming, low-doc, etc) */
  { id: "bluestone",        name: "Bluestone",            tier: "Specialist" },
  { id: "pepper",           name: "Pepper Money",         tier: "Specialist" },
  { id: "liberty",          name: "Liberty",              tier: "Specialist" },
  { id: "latrobe",          name: "La Trobe Financial",   tier: "Specialist" },
  { id: "assetline",        name: "Assetline",            tier: "Specialist" },
  { id: "granite",          name: "Granite",              tier: "Specialist" },
  { id: "redzed",           name: "RedZed",               tier: "Specialist" },
  { id: "thinktank",        name: "Thinktank",            tier: "Specialist" },
];

export const LENDER_TIERS: Lender["tier"][] = ["Big 4", "Major", "Non-bank", "Specialist"];

export function lenderById(id: string): Lender | undefined {
  return LENDERS.find((l) => l.id === id);
}

/** Resolve a lender id from a display name (as stored on deal.lender via
 *  parseLenderField). Case-insensitive. Returns undefined if no match. */
export function lenderIdByName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return LENDERS.find((l) => l.name.toLowerCase() === n)?.id;
}

/* -------------------------------------------------------------------------- */
/* Lender SLAs — turnaround expectations that drive follow-up urgency and    */
/* set customer expectations in comms.                                        */
/* -------------------------------------------------------------------------- */

/**
 * Turnaround metrics we track per lender, by product segment. Each governs
 * the expected wait while a deal sits in a particular stage, so we can tell
 * (a) the customer roughly when to expect news, and (b) the broker when a
 * deal has gone past the lender's own turnaround and needs chasing.
 *
 * Business days. Null means "not tracked" — comms simply omit the timeframe
 * rather than guess. Seeded from Mankin's Quickli SLA data (below) and
 * editable per lender in the SLA settings page.
 */
export interface LenderSlaValues {
  /** Purchase: submission -> conditional approval. */
  purchaseAssessDays: number | null;
  /** Refinance: submission -> conditional approval. */
  refinanceAssessDays: number | null;
  /** Pre-approval / AIP turnaround. */
  preApprovalDays: number | null;
  /** Conditional -> formal (unconditional) approval. */
  formalDays: number | null;
}

export const EMPTY_SLA: LenderSlaValues = {
  purchaseAssessDays: null,
  refinanceAssessDays: null,
  preApprovalDays: null,
  formalDays: null,
};

export interface LenderSlaMetric {
  key: keyof LenderSlaValues;
  label: string;
  hint: string;
}

/** Columns in the SLA editor. */
export const LENDER_SLA_METRICS: LenderSlaMetric[] = [
  { key: "purchaseAssessDays", label: "Purchase", hint: "Purchase: submission to conditional approval (business days)" },
  { key: "refinanceAssessDays", label: "Refinance", hint: "Refinance: submission to conditional approval (business days)" },
  { key: "preApprovalDays", label: "Pre-approval", hint: "Pre-approval / AIP turnaround (business days)" },
  { key: "formalDays", label: "Formal", hint: "Conditional to formal (unconditional) approval (business days)" },
];

/**
 * Seed SLAs from Mankin's Quickli panel data (as at 24 Jul 2026, business
 * days; hours rounded to 1 day, calendar-day figures approximated). These
 * are the defaults; the SLA editor overrides any lender in Postgres.
 * Lenders with no published SLA are omitted (treated as EMPTY_SLA).
 */
export const LENDER_SLA_SEED: Record<string, LenderSlaValues> = {
  anz:            { purchaseAssessDays: 2,  refinanceAssessDays: 2,  preApprovalDays: null, formalDays: null },
  cba:            { purchaseAssessDays: 2,  refinanceAssessDays: 2,  preApprovalDays: 2,    formalDays: null },
  nab:            { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: 1,    formalDays: null },
  westpac:        { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: 1,    formalDays: null },
  macquarie:      { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: 1,    formalDays: null },
  ing:            { purchaseAssessDays: 3,  refinanceAssessDays: 4,  preApprovalDays: 2,    formalDays: null },
  suncorp:        { purchaseAssessDays: 4,  refinanceAssessDays: 5,  preApprovalDays: 2,    formalDays: null },
  bankwest:       { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: null, formalDays: null },
  "st-george":    { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: 1,    formalDays: null },
  "me-bank":      { purchaseAssessDays: 6,  refinanceAssessDays: 6,  preApprovalDays: null, formalDays: null },
  amp:            { purchaseAssessDays: 2,  refinanceAssessDays: 2,  preApprovalDays: 8,    formalDays: null },
  bendigo:        { purchaseAssessDays: 2,  refinanceAssessDays: 2,  preApprovalDays: null, formalDays: null },
  "bank-australia": { purchaseAssessDays: 2, refinanceAssessDays: 2, preApprovalDays: null, formalDays: null },
  "great-southern": { purchaseAssessDays: 3, refinanceAssessDays: 3, preApprovalDays: 10,  formalDays: null },
  "bank-of-sydney": { purchaseAssessDays: 2, refinanceAssessDays: 2, preApprovalDays: null, formalDays: null },
  resimac:        { purchaseAssessDays: 3,  refinanceAssessDays: 3,  preApprovalDays: null, formalDays: 2 },
  ubank:          { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: 1,    formalDays: null },
  firstmac:       { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: null, formalDays: null },
  brighten:       { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: null, formalDays: 1 },
  "ma-money":     { purchaseAssessDays: 2,  refinanceAssessDays: 2,  preApprovalDays: null, formalDays: null },
  orde:           { purchaseAssessDays: 7,  refinanceAssessDays: 7,  preApprovalDays: 7,    formalDays: 7 },
  "people-first": { purchaseAssessDays: 10, refinanceAssessDays: 10, preApprovalDays: 15,   formalDays: null },
  bluestone:      { purchaseAssessDays: 8,  refinanceAssessDays: 8,  preApprovalDays: null, formalDays: null },
  pepper:         { purchaseAssessDays: 1,  refinanceAssessDays: 1,  preApprovalDays: null, formalDays: null },
  liberty:        { purchaseAssessDays: 8,  refinanceAssessDays: 8,  preApprovalDays: null, formalDays: 1 },
  latrobe:        { purchaseAssessDays: 13, refinanceAssessDays: 13, preApprovalDays: null, formalDays: null },
  assetline:      { purchaseAssessDays: 4,  refinanceAssessDays: 4,  preApprovalDays: null, formalDays: null },
  granite:        { purchaseAssessDays: 7,  refinanceAssessDays: 4,  preApprovalDays: null, formalDays: 5 },
  redzed:         { purchaseAssessDays: 3,  refinanceAssessDays: 3,  preApprovalDays: null, formalDays: null },
  thinktank:      { purchaseAssessDays: 4,  refinanceAssessDays: 4,  preApprovalDays: null, formalDays: 4 },
};

export function lendersByTier(tier: Lender["tier"]): Lender[] {
  return LENDERS.filter((l) => l.tier === tier);
}

/* -------------------------------------------------------------------------- */
/* Formatting (write time)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compose the canonical `deal.lender` string from a lender name + status.
 *
 *   formatLenderForDeal("CBA", "proposed")  → "CBA (proposed)"
 *   formatLenderForDeal("ING", "chosen")    → "ING (chosen)"
 *   formatLenderForDeal(null,  "tbc")       → "TBC"
 *   formatLenderForDeal(null,  "comparing") → "Comparing options"
 */
export function formatLenderForDeal(
  lenderName: string | null,
  status: LenderStatus,
): string {
  if (!lenderName) {
    return status === "comparing" ? "Comparing options" : "TBC";
  }
  if (status === "proposed") return `${lenderName} (proposed)`;
  if (status === "chosen") return `${lenderName} (chosen)`;
  return lenderName;
}

/* -------------------------------------------------------------------------- */
/* Parsing (read time). Extracts lender + status from deal.lender string.     */
/* -------------------------------------------------------------------------- */

export interface ParsedLender {
  lenderName: string | null;
  status: LenderStatus;
}

export function parseLenderField(raw: string | null | undefined): ParsedLender {
  if (!raw) return { lenderName: null, status: "tbc" };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "TBC" || trimmed.toUpperCase() === "TBD") {
    return { lenderName: null, status: "tbc" };
  }
  if (/^comparing/i.test(trimmed)) {
    return { lenderName: null, status: "comparing" };
  }
  // Current format: "<lender> (chosen)". Legacy format: "<lender> — chosen"
  // (kept for backward compatibility with any seeded data).
  const chosenParenMatch = /^(.+?)\s*\(chosen\)\s*$/i.exec(trimmed);
  if (chosenParenMatch) {
    return { lenderName: chosenParenMatch[1].trim(), status: "chosen" };
  }
  const chosenLegacyMatch = /^(.+?)\s+(?:—|--|-)\s*chosen\s*$/i.exec(trimmed);
  if (chosenLegacyMatch) {
    return { lenderName: chosenLegacyMatch[1].trim(), status: "chosen" };
  }
  const proposedMatch = /^(.+?)\s*\(proposed\)\s*$/i.exec(trimmed);
  if (proposedMatch) {
    return { lenderName: proposedMatch[1].trim(), status: "proposed" };
  }
  // Plain lender name with no status modifier.
  return { lenderName: trimmed, status: "proposed" };
}

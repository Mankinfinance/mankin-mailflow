/**
 * Quick-pick suggestions for the broker's "+ Add custom doc" dialog.
 * Picked from real Mankin Finance deals — the doc requests that come
 * up most often outside the standard rule-engine catalog. Tap one to
 * fill the name + hint + category fields in the dialog instead of
 * typing each time.
 *
 * Maintenance: when a custom doc gets requested on three or more deals,
 * promote it here. When something stops being useful, prune it.
 */

export interface CustomDocSuggestion {
  /** Display name shown in the dropdown + lands in the doc name field. */
  name: string;
  /** Customer-facing hint, lands in the hint field. */
  hint: string;
  /** Defaults to "Custom" if blank. */
  cat: string;
}

export const CUSTOM_DOC_SUGGESTIONS: CustomDocSuggestion[] = [
  /* -------------------------------------------------- Income / employment */
  {
    name: "Letter from accountant",
    hint: "On accountant letterhead, signed and dated within the last 3 months",
    cat: "Income · self-employed",
  },
  {
    name: "Letter from employer",
    hint: "Confirms position, salary + start date — on employer letterhead",
    cat: "Income",
  },
  {
    name: "BAS · most recent 4 quarters",
    hint: "Business Activity Statements for the last 12 months",
    cat: "Income · self-employed",
  },
  {
    name: "Centrelink statement",
    hint: "Most recent payment summary",
    cat: "Income",
  },
  {
    name: "Pension statement",
    hint: "Most recent age / disability pension confirmation",
    cat: "Income",
  },
  {
    name: "Maternity leave letter",
    hint: "On employer letterhead — return-to-work date, pre-leave salary and ongoing role",
    cat: "Income · on leave",
  },
  {
    name: "Workers compensation award letter",
    hint: "From the insurer — payment amount, payment frequency and likely duration",
    cat: "Income · workers comp",
  },
  {
    name: "Treating doctor's capacity certificate",
    hint: "Confirms current work capacity and likely return-to-work timeline",
    cat: "Income · workers comp",
  },

  /* -------------------------------------------------- Property / purchase */
  {
    name: "Contract of sale · signed",
    hint: "Fully executed contract for the property being purchased",
    cat: "Property purchase",
  },
  {
    name: "Section 32 / vendor statement",
    hint: "VIC properties only — provided by the vendor's solicitor",
    cat: "Property purchase",
  },
  {
    name: "Strata report / minutes",
    hint: "Last 2 years of minutes + most recent inspection report",
    cat: "Property purchase",
  },
  {
    name: "Pest + building inspection",
    hint: "Independent report covering structural + pest issues",
    cat: "Property purchase",
  },
  {
    name: "Valuation report",
    hint: "Lender-ordered valuation — we usually arrange this",
    cat: "Property purchase",
  },

  /* -------------------------------------------------- Deposit / gifts */
  {
    name: "Gift letter from parents",
    hint: "Signed declaration that the deposit gift is non-refundable",
    cat: "Deposit",
  },
  {
    name: "Statutory declaration · gift",
    hint: "Witnessed statement confirming the gift is unconditional",
    cat: "Deposit",
  },
  {
    name: "Source of deposit explanation",
    hint: "Short note explaining where the deposit funds came from",
    cat: "Deposit",
  },

  /* -------------------------------------------------- Refinance / discharge */
  {
    name: "Discharge authority · signed",
    hint: "Authorises the current lender to release the loan — we'll DocuSign",
    cat: "Refinance",
  },
  {
    name: "Council rates notice",
    hint: "Most recent rates notice for the security property",
    cat: "Property · existing",
  },
  {
    name: "Water rates notice",
    hint: "Most recent water bill for the property",
    cat: "Property · existing",
  },

  /* -------------------------------------------------- Insurance */
  {
    name: "Certificate of currency · home insurance",
    hint: "Building insurance noting the lender as interested party",
    cat: "Insurance",
  },
  {
    name: "Landlord insurance certificate",
    hint: "Required for investment properties before settlement",
    cat: "Insurance",
  },

  /* -------------------------------------------------- Construction */
  {
    name: "Fixed-price building contract",
    hint: "Signed contract from a licensed builder",
    cat: "Construction",
  },
  {
    name: "Council-approved plans",
    hint: "Stamped plans showing approval has been granted",
    cat: "Construction",
  },
  {
    name: "Schedule of progress payments",
    hint: "Stages from slab through to completion",
    cat: "Construction",
  },

  /* -------------------------------------------------- ID / verification */
  {
    name: "Marriage certificate",
    hint: "If name on docs differs from name on ID",
    cat: "Get started",
  },
  {
    name: "Change of name certificate",
    hint: "If name on docs differs from name on ID",
    cat: "Get started",
  },
  {
    name: "Visa grant letter",
    hint: "For non-citizens — confirms residency status",
    cat: "Get started",
  },

  /* -------------------------------------------------- SMSF */
  {
    name: "SMSF trust deed",
    hint: "Signed deed for the super fund — original execution + any amendments",
    cat: "SMSF",
  },
  {
    name: "SMSF investment strategy",
    hint: "Current investment strategy document",
    cat: "SMSF",
  },
  {
    name: "SMSF audit report",
    hint: "Most recent annual audit",
    cat: "SMSF",
  },
];

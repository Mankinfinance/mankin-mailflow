import type { DocCatalogItem } from "./types";
import { DOC_RULES } from "@/lib/doc-rules";

/**
 * Master doc catalog. Every doc id the dashboard, portal, or composer
 * might render has a human-readable name + customer-friendly hint here.
 *
 * Two registries feed into docById():
 *
 *  1. DOC_CATALOG (this file) — covers the pre-configurator-era docs
 *     plus a few extras the rule engine doesn't produce (signed
 *     acceptance, certificate of currency, etc).
 *
 *  2. DOC_RULES (lib/doc-rules.ts) — the configurator rule engine.
 *     Every id it can emit (id-a1, super-a2, fhb-declaration,
 *     fhbg-app, credit-cards, etc) gets resolved through the same
 *     docById() so the deal drawer never falls back to showing the
 *     raw id string to customers or brokers.
 *
 * Lookup is by string id; the Deal model references ids only.
 */

const PHASE_1: DocCatalogItem[] = [
  // Privacy form: customer signs it (usually sent via DocuSign) then
  // ticks the checkbox here to confirm. No file upload required.
  {
    id: "privacy",
    name: "Signed privacy form",
    hint: "Tick to confirm you have signed the privacy form we sent you via DocuSign.",
    stage: "pre",
    selfCertify: true,
  },
  { id: "id",         name: "ID documents",                                  hint: "Passport, Driver licence, Medicare", stage: "pre" },
  { id: "payslips",   name: "Latest 2 payslips",                             hint: "Within 6 weeks old", stage: "assess" },
  { id: "pays-yr",    name: "Latest income tax assessment",                  hint: "Most recent tax year — replaces the old group certificate", stage: "assess" },
  { id: "tax-self",   name: "Tax returns + Notices of Assessment · 2 years", hint: "Self-employed only", stage: "assess" },
  { id: "company",    name: "Company tax returns + financials · 2 years",    hint: "Company entity only · P&L, balance sheet, prepared by accountant", stage: "assess" },
  { id: "loans",      name: "Existing loan statements",                      hint: "Latest, within 6 weeks", stage: "assess" },
  { id: "rentals",    name: "Rental statements · 2 months",                  hint: "Per existing investment property", stage: "assess" },
  { id: "super",      name: "Super statements · 12 months",                  hint: "All super accounts in your name", stage: "assess" },
  { id: "other-loan", name: "Other loan facility statements",                hint: "Personal, car, BNPL, credit cards", stage: "assess" },
  { id: "savings",    name: "Savings statements · 3 months",                 hint: "Account where your salary is paid", stage: "assess" },
  { id: "deposit",    name: "Deposit evidence",                              hint: "Statement within 6 weeks showing deposit funds", stage: "assess" },
  { id: "dependents", name: "Dependents declaration",                        hint: "Number of dependents, ages, schooling costs", stage: "assess" },
];

const PHASE_2: DocCatalogItem[] = [
  // Loan application pack + signed acceptance are also DocuSign'd
  // through Salestrekker. The customer signs them in their inbox; the
  // signed copies sync back to us. No portal upload required.
  {
    id: "loan-app-pack",
    name: "Signed loan application pack",
    hint: "We send this via DocuSign separately. Sign in your inbox.",
    stage: "lodge",
    external: { via: "DocuSign via Salestrekker" },
  },
  {
    id: "signed-acceptance",
    name: "Signed loan offer / acceptance",
    hint: "We send this via DocuSign once the lender issues conditional approval.",
    stage: "lodge",
    external: { via: "DocuSign via Salestrekker" },
  },
  { id: "cert-currency",     name: "Certificate of currency · home insurance", hint: "Required by the lender before settlement", stage: "lodge" },
];

export const DOC_CATALOG: readonly DocCatalogItem[] = [...PHASE_1, ...PHASE_2];

/**
 * Flat index over every DOC_RULES entry so docById can resolve ids the
 * configurator emits (id-a1, super-a2, fhb-declaration, fhbg-app, ...).
 * Built once at module load — no per-call work. DOC_CATALOG entries win
 * when an id appears in both registries.
 */
const DOC_RULES_INDEX: Record<string, { name: string; hint?: string; cat?: string }> = (() => {
  const map: Record<string, { name: string; hint?: string; cat?: string }> = {};
  for (const list of Object.values(DOC_RULES)) {
    for (const d of list) {
      if (!map[d.id]) {
        map[d.id] = { name: d.name, hint: d.hint, cat: d.cat };
      }
    }
  }
  return map;
})();

export function docById(id: string): DocCatalogItem {
  const fromCatalog = DOC_CATALOG.find((d) => d.id === id);
  if (fromCatalog) return fromCatalog;
  const fromRules = DOC_RULES_INDEX[id];
  if (fromRules) {
    return {
      id,
      name: fromRules.name,
      ...(fromRules.hint ? { hint: fromRules.hint } : {}),
      stage: "assess",
    };
  }
  // Broker-added custom docs have IDs like "custom-<slug>". Reconstruct a
  // readable name from the slug so emails never show the raw ID string.
  if (id.startsWith("custom-")) {
    const name = id
      .slice("custom-".length)
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return { id, name, stage: "assess" };
  }
  return { id, name: id, stage: "assess" };
}

/**
 * Resolve the human-readable name for any doc id, including broker-added
 * custom docs (which don't exist in the catalog). Always pass deal.customDocs
 * as the first argument so custom docs take priority over the catalog fallback.
 */
export function docName(
  customDocs: ReadonlyArray<{ id: string; name: string }> | null | undefined,
  id: string,
): string {
  const custom = (customDocs ?? []).find((c) => c.id === id);
  return custom ? custom.name : docById(id).name;
}

/**
 * Appended to the privacy form on outstanding-doc lists in EMAIL/brief
 * drafts only. The privacy form is DocuSigned to the customer by email, so
 * the line points them at their inbox / spam rather than reading like a
 * document they need to find and send us.
 */
export const PRIVACY_FORM_EMAIL_NOTE =
  " (have sent this to you via email, please check your spam folder in case it ends up here)";

/**
 * Email-only variant of docName. Identical to docName except the privacy
 * form gets the spam-folder reminder appended. Use this in email / EOD /
 * re-engagement / Claude-draft copy — NOT in the portal or dashboard, where
 * the privacy form is a self-certify checkbox and the note would confuse.
 */
export function docNameForEmail(
  customDocs: ReadonlyArray<{ id: string; name: string }> | null | undefined,
  id: string,
): string {
  const base = docName(customDocs, id);
  return id === "privacy" ? `${base}${PRIVACY_FORM_EMAIL_NOTE}` : base;
}

/**
 * Friendly category buckets shown to the customer on the portal.
 * Sourced from design/components/portal.jsx (line 422: cats = [...]).
 */
export const PORTAL_CATEGORIES = [
  "Get started",
  "Income",
  "Property & loans",
  "Banking",
  "Pre-lodgement",
] as const;
export type PortalCategory = (typeof PORTAL_CATEGORIES)[number];

const DOC_CATEGORY: Record<string, PortalCategory> = {
  privacy: "Get started",
  id: "Get started",

  payslips: "Income",
  "pays-yr": "Income",
  "tax-self": "Income",
  company: "Income",
  super: "Income",

  loans: "Property & loans",
  rentals: "Property & loans",
  "other-loan": "Property & loans",

  savings: "Banking",
  deposit: "Banking",
  dependents: "Banking",

  "loan-app-pack": "Pre-lodgement",
  "signed-acceptance": "Pre-lodgement",
  "cert-currency": "Pre-lodgement",
};

/**
 * Map a DOC_RULES configurator category onto the portal's coarser
 * five-bucket category so the customer portal still groups uploads
 * cleanly when a configurator-emitted doc ends up on a deal.
 */
const CAT_RULES_TO_PORTAL: Record<string, PortalCategory> = {
  "Get started": "Get started",
  Banking: "Banking",
  Income: "Income",
  "Income — self-employed": "Income",
  "First home buyer": "Get started",
  "First home buyer · scheme": "Pre-lodgement",
  "Investment property": "Property & loans",
  Refinance: "Property & loans",
  "Existing loans": "Property & loans",
  Construction: "Pre-lodgement",
  Bridging: "Pre-lodgement",
};

export function categoryFor(docId: string): PortalCategory {
  if (DOC_CATEGORY[docId]) return DOC_CATEGORY[docId];
  const rules = DOC_RULES_INDEX[docId];
  if (rules?.cat) {
    return CAT_RULES_TO_PORTAL[rules.cat] ?? "Get started";
  }
  return "Get started";
}

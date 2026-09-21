/**
 * Portal configurator rule engine — ported VERBATIM from
 * design_handoff_lead_followup/design/components/portal-configurator.jsx
 * (DOC_RULES constant + buildDocList function).
 *
 * Pure module — safe to import from client components.
 *
 * Categories here use the configurator's own labels (richer than the
 * five categories used on the portal page itself) so the live preview
 * renders the doc list grouped the way brokers expect.
 */

export type Employment =
  | "payg"
  | "self-sole"
  | "self-company"
  | "self-trust"
  | "maternity-leave"
  | "workers-comp"
  | "centrelink-pension";
export type BuyerType = "first-home" | "upgrader" | "investor" | "refinancer";
export type Scheme = "fhg" | "fhbg-nsw";

export interface Applicant {
  employment: Employment;
}

export interface Flags {
  hasInvestment: boolean;
  hasHomeLoan: boolean;
  hasOtherLoans: boolean;
  hasCreditCards: boolean;
  hasDependents: boolean;
  isConstruction: boolean;
  isBridging: boolean;
  isSmsf: boolean;
}

export interface Profile {
  joint: boolean;
  buyerType: BuyerType;
  applicants: Applicant[];
  schemes: Scheme[];
  flags: Flags;
}

export interface ConfiguratorDoc {
  id: string;
  name: string;
  hint?: string;
  cat: string;
}

type RuleKey =
  | "base"
  | "joint"
  | Employment
  | BuyerType
  | "hasInvestment"
  | "hasHomeLoan"
  | "hasOtherLoans"
  | "hasCreditCards"
  | "hasDependents"
  | Scheme
  | "construction"
  | "bridging"
  | "smsf";

export const DOC_RULES: Record<RuleKey, ConfiguratorDoc[]> = {
  // Always asked, regardless of profile
  base: [
    { id: "privacy",   name: "Signed privacy form",                hint: "We send this via DocuSign — tick once signed", cat: "Get started" },
    { id: "id-a1",     name: "ID documents · Applicant 1",         hint: "Passport, driver licence + Medicare card", cat: "Get started" },
    { id: "savings",   name: "Savings statements · 3 months",      hint: "The account your salary is paid into", cat: "Banking" },
    { id: "super",     name: "Super statements · 12 months",       hint: "All super accounts in your name", cat: "Banking" },
    { id: "deposit",   name: "Deposit evidence",                   hint: "Statement within the last 6 weeks showing your deposit funds", cat: "Banking" },
  ],
  joint: [
    { id: "id-a2",     name: "ID documents · Applicant 2",                hint: "Passport, driver licence + Medicare card", cat: "Get started" },
    { id: "super-a2",  name: "Super statements · Applicant 2 · 12 months", hint: "All super accounts in their name", cat: "Banking" },
  ],
  // Employment-driven
  payg: [
    { id: "payslips",    name: "Latest 2 payslips",               hint: "Within the last 6 weeks", cat: "Income" },
    { id: "tax-summary", name: "Latest income tax assessment",    hint: "Most recent tax year — replaces the old group certificate", cat: "Income" },
  ],
  "self-sole": [
    { id: "tax-individual", name: "Individual tax returns · 2 years",      hint: "Most recent two financial years", cat: "Income · self-employed" },
    { id: "noa-individual", name: "Notices of Assessment · 2 years",       hint: "ATO confirmation matching the tax returns above", cat: "Income · self-employed" },
  ],
  "self-company": [
    { id: "tax-individual", name: "Individual tax returns · 2 years",      hint: "Most recent two financial years", cat: "Income · self-employed" },
    { id: "noa-individual", name: "Notices of Assessment · 2 years",       hint: "ATO confirmation matching the tax returns above", cat: "Income · self-employed" },
    { id: "tax-company",    name: "Company tax returns · 2 years",         hint: "For the trading entity", cat: "Income · self-employed" },
    { id: "fin-company",    name: "Company financial statements · 2 years", hint: "P&L + balance sheet prepared by your accountant", cat: "Income · self-employed" },
  ],
  "self-trust": [
    { id: "tax-individual", name: "Individual tax returns · 2 years",      hint: "Most recent two financial years", cat: "Income · self-employed" },
    { id: "noa-individual", name: "Notices of Assessment · 2 years",       hint: "ATO confirmation matching the tax returns above", cat: "Income · self-employed" },
    { id: "tax-trust",      name: "Trust tax returns · 2 years",           hint: "For the trust entity", cat: "Income · self-employed" },
    { id: "trust-deed",     name: "Signed trust deed",                     hint: "Original execution + any amendments since", cat: "Income · self-employed" },
  ],
  "maternity-leave": [
    { id: "matleave-letter", name: "Maternity leave letter from employer",       hint: "On employer letterhead — return-to-work date, pre-leave salary and ongoing role", cat: "Income · on leave" },
    { id: "payslips-pre",    name: "2 payslips before leave commenced",          hint: "The last two payslips before going on parental leave", cat: "Income · on leave" },
    { id: "tax-summary",     name: "Latest income tax assessment",               hint: "Most recent ATO Notice of Assessment confirming pre-leave income", cat: "Income · on leave" },
    { id: "ppl-evidence",    name: "Paid parental leave evidence (if receiving)", hint: "Centrelink PPL statement or employer top-up letter, only if currently being paid", cat: "Income · on leave" },
  ],
  "workers-comp": [
    { id: "comp-award",     name: "Workers compensation payment letter",      hint: "Award / determination letter from the insurer showing amount + duration", cat: "Income · workers comp" },
    { id: "comp-doctor",    name: "Treating doctor's capacity certificate",   hint: "Most recent — confirms work capacity and likely return-to-work timeline", cat: "Income · workers comp" },
    { id: "comp-employer",  name: "Employer letter · role on return",         hint: "On employer letterhead — confirms role and salary once back at work", cat: "Income · workers comp" },
    { id: "tax-summary",    name: "Latest income tax assessment",             hint: "Most recent ATO Notice of Assessment confirming pre-injury income", cat: "Income · workers comp" },
  ],
  "centrelink-pension": [
    { id: "centrelink-stmt",   name: "Centrelink income statement · 90 days", hint: "Download from myGov — covers all payments received in the last three months", cat: "Income · Centrelink" },
    { id: "pension-letter",    name: "Pension or payment confirmation letter", hint: "Age pension, DSP, carer payment, JobSeeker or family tax benefit — whichever applies", cat: "Income · Centrelink" },
    { id: "centrelink-mygov",  name: "myGov income and asset summary",        hint: "Optional — replaces the pension letter when broker prefers a one-pager", cat: "Income · Centrelink" },
    { id: "tax-summary",       name: "Latest income tax assessment",           hint: "Most recent ATO Notice of Assessment confirming continuity", cat: "Income · Centrelink" },
  ],
  // Buyer type
  "first-home": [
    { id: "fhb-declaration", name: "First home buyer declaration",      hint: "Confirms you're eligible for the FHB grant / stamp duty concession", cat: "First home buyer" },
    { id: "genuine-savings", name: "Genuine savings evidence",          hint: "Show 5% of the purchase price has been in your account for 3+ months", cat: "First home buyer" },
  ],
  upgrader: [],
  investor: [
    { id: "rentals",  name: "Rental statements · 2 months",                  hint: "One per existing investment property", cat: "Investment property" },
    { id: "inv-loan", name: "Investment loan statements",                    hint: "Most recent, within the last 6 weeks", cat: "Investment property" },
  ],
  refinancer: [
    { id: "existing-loan", name: "Current home loan statement",              hint: "Most recent, within the last 6 weeks", cat: "Refinance" },
    { id: "rates-notice",  name: "Latest council rates notice",              hint: "For the property being refinanced", cat: "Refinance" },
    { id: "discharge",     name: "Discharge authority form",                 hint: "Authorises your current lender to release the loan — we'll send the DocuSign", cat: "Refinance" },
  ],
  // Flags
  hasInvestment: [
    { id: "rentals",  name: "Rental statements · 2 months",                  hint: "One per existing investment property", cat: "Investment property" },
    { id: "inv-loan", name: "Investment loan statements",                    hint: "Most recent, within the last 6 weeks", cat: "Investment property" },
  ],
  hasHomeLoan: [
    { id: "existing-loan", name: "Current home loan statement",              hint: "Most recent, within the last 6 weeks", cat: "Existing loans" },
  ],
  hasOtherLoans: [
    { id: "other-loans", name: "Statements for other loans",                 hint: "Personal loans, car loans, Afterpay / Zip / BNPL", cat: "Existing loans" },
  ],
  hasCreditCards: [
    { id: "credit-cards", name: "Latest credit card statements",             hint: "Every card in your name, most recent statement", cat: "Existing loans" },
  ],
  hasDependents: [
    { id: "dependents", name: "Dependents declaration",                      hint: "Names, ages, schooling + childcare costs", cat: "Banking" },
  ],
  // Government schemes (FHB)
  "fhbg-nsw": [
    { id: "fhbg-app", name: "NSW First Home Buyer Assistance application",   hint: "Stamp duty concession or exemption · for properties under $1m", cat: "First home buyer · scheme" },
    { id: "contract", name: "Contract of sale",                              hint: "Your signed contract for the property purchase", cat: "First home buyer · scheme" },
    { id: "fhog-nsw", name: "NSW First Home Owner Grant application",        hint: "$10k grant · new builds only", cat: "First home buyer · scheme" },
  ],
  fhg: [
    { id: "fhg-eligibility", name: "First Home Guarantee eligibility check", hint: "Income under $125k single / $200k joint · Australian citizen", cat: "First home buyer · scheme" },
    { id: "notice-ato",      name: "ATO Notice of Assessment",               hint: "Confirms you meet the FHG income cap", cat: "First home buyer · scheme" },
    { id: "contract",        name: "Contract of sale",                       hint: "Your signed contract for the property purchase", cat: "First home buyer · scheme" },
  ],
  construction: [
    { id: "builders-quote",  name: "Builder's quote or tender",              hint: "Fixed-price contract from a licensed builder", cat: "Construction" },
    { id: "building-plans",  name: "Building plans + specifications",        hint: "Council-approved drawings", cat: "Construction" },
    { id: "land-contract",   name: "Land contract of sale",                  hint: "Only for separate land + build deals", cat: "Construction" },
    { id: "builder-licence", name: "Builder licence + insurance certificate", hint: "Builders Indemnity Insurance + active state licence", cat: "Construction" },
    { id: "progress-draws",  name: "Progress payment schedule",              hint: "Slab → frame → lockup → fixing → completion", cat: "Construction" },
  ],
  bridging: [
    { id: "sale-contract",      name: "Sale contract · existing property",   hint: "Only if your current home is already on the market", cat: "Bridging" },
    { id: "valuation-existing", name: "Valuation of existing property",      hint: "We'll arrange this on your behalf", cat: "Bridging" },
  ],
  smsf: [
    { id: "smsf-trust-deed",       name: "Certified SMSF trust deed",                hint: "Certified copy of the SMSF's trust deed including any amendments", cat: "SMSF" },
    { id: "bare-trust-deed",       name: "Certified Bare Trust deed",                hint: "Certified copy of the bare trust deed for the property purchase", cat: "SMSF" },
    { id: "co-const-bare",         name: "Company constitution · bare trustee",      hint: "Constitution of the company acting as bare trustee for the property", cat: "SMSF" },
    { id: "co-const-smsf",         name: "Company constitution · SMSF trustee",     hint: "Constitution of the company acting as trustee of the SMSF", cat: "SMSF" },
    { id: "smsf-statements",       name: "SMSF account statements · 12 months",     hint: "All accounts held by the SMSF fund — cash, investment, and sub-accounts", cat: "SMSF" },
    { id: "smsf-cash-mgmt",        name: "Cash management account statement",        hint: "Most recent statement for the SMSF's cash management account", cat: "SMSF" },
  ],
};

export function buildDocList(profile: Profile): ConfiguratorDoc[] {
  const out: ConfiguratorDoc[] = [];
  const seen = new Set<string>();
  const add = (rule: ConfiguratorDoc[] | undefined): void => {
    if (!rule) return;
    for (const d of rule) {
      if (!seen.has(d.id)) {
        out.push(d);
        seen.add(d.id);
      }
    }
  };

  add(DOC_RULES.base);
  if (profile.joint) add(DOC_RULES.joint);

  for (const a of profile.applicants) add(DOC_RULES[a.employment]);

  add(DOC_RULES[profile.buyerType]);

  for (const s of profile.schemes) add(DOC_RULES[s]);

  if (profile.flags.isConstruction) add(DOC_RULES.construction);
  if (profile.flags.isBridging) add(DOC_RULES.bridging);
  if (profile.flags.isSmsf) add(DOC_RULES.smsf);

  if (profile.flags.hasInvestment && profile.buyerType !== "investor") add(DOC_RULES.hasInvestment);
  if (profile.flags.hasHomeLoan && profile.buyerType !== "refinancer") add(DOC_RULES.hasHomeLoan);
  if (profile.flags.hasOtherLoans) add(DOC_RULES.hasOtherLoans);
  if (profile.flags.hasCreditCards) add(DOC_RULES.hasCreditCards);
  if (profile.flags.hasDependents) add(DOC_RULES.hasDependents);

  return out;
}

export function defaultProfile(): Profile {
  return {
    joint: true,
    buyerType: "first-home",
    applicants: [{ employment: "payg" }, { employment: "payg" }],
    schemes: [],
    flags: {
      hasInvestment: false,
      hasHomeLoan: false,
      hasOtherLoans: false,
      hasCreditCards: true,
      hasDependents: false,
      isConstruction: false,
      isBridging: false,
      isSmsf: false,
    },
  };
}

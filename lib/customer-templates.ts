import type { Profile } from "./doc-rules";

/**
 * Customer templates — ported verbatim from
 * design_handoff_lead_followup/design/components/portal-configurator.jsx
 * (CUSTOMER_TEMPLATES constant, lines 146-277).
 *
 * Each template provides a profile() factory so the broker can pick a
 * sensible starting point in the configurator, then customise from there.
 */

export interface CustomerTemplate {
  id: string;
  icon: string;
  label: string;
  sub: string;
  tags: string[];
  profile: () => Profile;
}

export const CUSTOMER_TEMPLATES: readonly CustomerTemplate[] = [
  {
    id: "fhb-cash",
    icon: "🏠",
    label: "First home buyer · cash deposit",
    sub: "Joint · PAYG · 20% deposit saved",
    tags: ["Most common"],
    profile: () => ({
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
    }),
  },
  {
    id: "fhb-fhg",
    icon: "🎫",
    label: "First home buyer · under FHG",
    sub: "First Home Guarantee · 5% deposit · no LMI",
    tags: ["Scheme"],
    profile: () => ({
      joint: false,
      buyerType: "first-home",
      applicants: [{ employment: "payg" }],
      schemes: ["fhg"],
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
    }),
  },
  {
    id: "fhb-nsw-grant",
    icon: "🇦🇺",
    label: "First home buyer · NSW grant",
    sub: "Stamp duty concession + FHOG (new build)",
    tags: ["Scheme", "NSW"],
    profile: () => ({
      joint: true,
      buyerType: "first-home",
      applicants: [{ employment: "payg" }, { employment: "payg" }],
      schemes: ["fhbg-nsw"],
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
    }),
  },
  {
    id: "upgrader",
    icon: "🔑",
    label: "Owner-occupier upgrader",
    sub: "Existing home loan · joint · PAYG",
    tags: [],
    profile: () => ({
      joint: true,
      buyerType: "upgrader",
      applicants: [{ employment: "payg" }, { employment: "payg" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: true,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "refinancer",
    icon: "🔄",
    label: "Refinancer",
    sub: "Switching from current lender",
    tags: [],
    profile: () => ({
      joint: true,
      buyerType: "refinancer",
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
    }),
  },
  {
    id: "investor-payg",
    icon: "🏘",
    label: "Investor · PAYG",
    sub: "Investment property · already employed",
    tags: [],
    profile: () => ({
      joint: false,
      buyerType: "investor",
      applicants: [{ employment: "payg" }],
      schemes: [],
      flags: {
        hasInvestment: true,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: false,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "self-emp-sole",
    icon: "📈",
    label: "Self-employed · Sole trader",
    sub: "2 yrs ITR + NOA · single applicant",
    tags: ["Self-employed"],
    profile: () => ({
      joint: false,
      buyerType: "upgrader",
      applicants: [{ employment: "self-sole" }],
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
    }),
  },
  {
    id: "self-emp-company",
    icon: "🏢",
    label: "Self-employed · Pty Ltd",
    sub: "Company tax + financials · individual + company",
    tags: ["Self-employed"],
    profile: () => ({
      joint: false,
      buyerType: "investor",
      applicants: [{ employment: "self-company" }],
      schemes: [],
      flags: {
        hasInvestment: true,
        hasHomeLoan: false,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: false,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "construction",
    icon: "🏗",
    label: "Construction loan",
    sub: "Land + build · progress draws",
    tags: ["Build"],
    profile: () => ({
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
        isConstruction: true,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "bridging",
    icon: "🌉",
    label: "Bridging loan",
    sub: "Buy before sell · existing property in transition",
    tags: ["Bridging"],
    profile: () => ({
      joint: true,
      buyerType: "upgrader",
      applicants: [{ employment: "payg" }, { employment: "payg" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: false,
        isConstruction: false,
        isBridging: true,
        isSmsf: false,
      },
    }),
  },
  /* Income-source templates - use when the applicant is on maternity
     leave, on workers comp, or on Centrelink as their main income. The
     buyerType picks the customer's actual situation (defaulting to
     refinancer for the most common backlog case); the broker can untick
     any docs that don't apply in the picker. */
  {
    id: "maternity-leave",
    icon: "👶",
    label: "Income from maternity leave",
    sub: "Employer letter + pre-leave payslips · refinance default",
    tags: ["Income source"],
    profile: () => ({
      joint: false,
      buyerType: "refinancer",
      applicants: [{ employment: "maternity-leave" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: true,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "workers-comp",
    icon: "🩹",
    label: "Income from workers compensation",
    sub: "Comp letter + capacity certificate · refinance default",
    tags: ["Income source"],
    profile: () => ({
      joint: false,
      buyerType: "refinancer",
      applicants: [{ employment: "workers-comp" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: false,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "centrelink-pension",
    icon: "🏛",
    label: "Income from Centrelink / pension",
    sub: "Centrelink statement + payment letter · refinance default",
    tags: ["Income source"],
    profile: () => ({
      joint: false,
      buyerType: "refinancer",
      applicants: [{ employment: "centrelink-pension" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: true,
        hasOtherLoans: false,
        hasCreditCards: true,
        hasDependents: false,
        isConstruction: false,
        isBridging: false,
        isSmsf: false,
      },
    }),
  },
  {
    id: "smsf-purchase",
    icon: "🏦",
    label: "SMSF property purchase",
    sub: "Company trustee · bare trust structure · investor",
    tags: ["SMSF"],
    profile: () => ({
      joint: false,
      buyerType: "investor",
      applicants: [{ employment: "payg" }],
      schemes: [],
      flags: {
        hasInvestment: false,
        hasHomeLoan: false,
        hasOtherLoans: false,
        hasCreditCards: false,
        hasDependents: false,
        isConstruction: false,
        isBridging: false,
        isSmsf: true,
      },
    }),
  },
];

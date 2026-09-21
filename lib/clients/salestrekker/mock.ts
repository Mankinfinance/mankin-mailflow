import "server-only";

import type { Deal, MankinStage, StageId } from "./types";
import { MANKIN_FROM_STAGE, EMPTY_PERSON_DETAILS } from "./types";

/**
 * Mock Salestrekker dataset — spread across the canonical B.1-B.7
 * stages so every Kanban column shows at least one card. Sourced
 * originally from design_handoff_lead_followup/design/components/
 * dashboard.jsx LEADS (lines 43-110) and extended with extra deals so
 * stages B.3a → B.6 aren't empty.
 *
 * Returned by the SalestrekkerClient when MOCK_SALESTREKKER=true so the
 * dashboard can be built and demoed without the real CRM. Same shape as
 * the eventual API response so the dashboard code is agnostic.
 *
 * The raw entries omit fields that have a sensible default — currently
 * nurturedAt + nurtureReason. They're filled in below so the exported
 * MOCK_DEALS satisfies the full Deal interface without every row
 * having to repeat the same null pair.
 */

type MockDealInput = Omit<
  Deal,
  | "nurturedAt"
  | "nurtureReason"
  | "leadCategory"
  | "leadSource"
  | "mankinStage"
  | "priorityFlag"
  | "comments"
  | "referrer"
  | "referrerId"
  | "preApprovalDate"
  | "preApprovalExpiry"
  | "giftcardSent"
  | "commission"
  | "applicants"
  | "guarantors"
  | "secondaryEmail"
> & { secondaryEmail?: string };

/** Mankin's actual top-of-funnel sources used to seed mock data so the
 *  Overview page's source breakdown looks realistic. */
const MOCK_SOURCES = [
  "Personal",
  "Referral",
  "Carbone",
  "Sigma",
  "BNI",
  "IW",
  "Fincare",
  "LJ Hooker",
  "Mortgage Goals",
  "Instagram",
];

/** Map a deal's stage + index to a plausible lead category. */
function categoryFor(stageId: StageId, i: number): Deal["leadCategory"] {
  if (stageId === "settled") return "settled";
  // Spread across the Mankin lead categories so the dashboard breakdown
  // shows something interesting on mock data.
  return ["purchase", "refinance", "smsf", "construction", "business", "asset"][
    i % 6
  ] as Deal["leadCategory"];
}

const RAW_MOCK_DEALS: MockDealInput[] = [
  {
    id: "l1",
    appRef: "MF-2410",
    name: "Sarah & Tom Reilly",
    // Sample purchase deal with a conveyancer filled in so the
    // ConveyancerCard renders populated state on first load.
    email: "sarah.reilly@gmail.com",
    // Combined "A & B" applicant — Tom's address rides along as the
    // second email so both partners are CC'd on every customer email.
    secondaryEmail: "tom.reilly@gmail.com",
    phone: "0411 234 567",
    stageId: "pre-lodge",
    daysSinceContact: 5,
    lender: "Westpac (proposed)",
    settlement: "14 Jul",
    avatar: "#e0b48a",
    brokerId: "mm",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super"],
    pending: ["loans", "savings", "deposit"],
    overdue: ["rentals"],
    advisory: [
      {
        id: "payslips",
        state: "stale",
        note: "Latest is from 8 weeks ago, so please send your two most recent.",
      },
    ],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "purchase",
    conveyancer: {
      name: "Sophie Lin",
      firm: "Lin Conveyancing",
      phone: "0412 345 678",
      email: "sophie@linconveyancing.com.au",
    },
    loanAmount: 485000,
    settledOn: null,
  },
  {
    id: "l2",
    appRef: "MF-2411",
    name: "James Doukas",
    email: "jdoukas@outlook.com",
    phone: "0488 121 442",
    stageId: "pre-lodge",
    daysSinceContact: 2,
    lender: "TBC",
    settlement: "TBD",
    avatar: "#a8c4d4",
    brokerId: "na",
    associateId: "nn",
    received: [],
    pending: ["privacy", "id"],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: null,
    settledOn: null,
  },
  {
    id: "l3",
    appRef: "MF-2407",
    name: "Priya & Anish Kumar",
    email: "priya.k@protonmail.com",
    phone: "0402 887 991",
    stageId: "cond-approved",
    daysSinceContact: 9,
    lender: "CBA",
    settlement: "02 Jul",
    avatar: "#c5b8d8",
    brokerId: "rl",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit"],
    pending: ["dependents", "loan-app-pack"],
    overdue: ["signed-acceptance"],
    advisory: [
      {
        id: "deposit",
        state: "incomplete",
        note: "Page 3 of the statement is missing, so please resend the full PDF.",
      },
    ],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 720000,
    settledOn: null,
  },
  {
    id: "l4",
    appRef: "MF-2399",
    name: "Liam O’Brien",
    email: "liam.obrien@hey.com",
    phone: "0438 552 008",
    stageId: "lodged",
    daysSinceContact: 14,
    lender: "ING",
    settlement: "24 Jun",
    avatar: "#d4a8a8",
    brokerId: "ds",
    associateId: "nn",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "rentals"],
    pending: ["signed-acceptance"],
    overdue: ["cert-currency", "loan-app-pack"],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: true,
    purpose: "unknown",
    conveyancer: null, // example: opted out of daily 4pm updates
    loanAmount: 560000,
    settledOn: null,
  },
  {
    id: "l5",
    appRef: "MF-2412",
    name: "Mei Tanaka",
    email: "mei.t@gmail.com",
    phone: "0421 008 117",
    stageId: "pre-lodge",
    daysSinceContact: 1,
    lender: "Comparing 3 options",
    settlement: "21 Jul",
    avatar: "#b8d4c5",
    brokerId: "mm",
    associateId: "mp",
    received: [
      "privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "dependents",
    ],
    pending: ["other-loan"],
    overdue: [],
    advisory: [
      {
        id: "other-loan",
        state: "stale",
        note: "BNPL statement only covers 30 days and the lender needs 90 days. Could you log in and export the full period?",
      },
    ],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: null,
    settledOn: null,
  },
  {
    id: "l6",
    appRef: "MF-2413",
    name: "Daniel Petrovic",
    email: "d.petrovic@gmail.com",
    phone: "0407 314 002",
    stageId: "pre-lodge",
    daysSinceContact: 4,
    lender: "TBC",
    settlement: "TBD",
    avatar: "#a8d4a8",
    brokerId: "na",
    associateId: "nn",
    received: ["privacy"],
    pending: ["id", "payslips", "pays-yr"],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: null,
    settledOn: null,
  },
  /* --------------------------------------------------------------------- *
   * B.3b Pre-Approval Only — house-hunting clients with approval in hand
   * --------------------------------------------------------------------- */
  {
    id: "l11",
    appRef: "MF-2415",
    name: "Hannah Wright",
    email: "h.wright@yahoo.com",
    phone: "0419 332 008",
    stageId: "pre-approval",
    daysSinceContact: 6,
    lender: "NAB",
    settlement: "TBD",
    avatar: "#d4b8c5",
    brokerId: "mm",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings"],
    pending: ["contract-of-sale"],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 540000,
    settledOn: null,
  },
  /* --------------------------------------------------------------------- *
   * B.4 Unconditional — finalised, awaiting loan docs from the lender
   * --------------------------------------------------------------------- */
  {
    id: "l12",
    appRef: "MF-2402",
    name: "Marco & Lena Russo",
    email: "marco.russo@gmail.com",
    phone: "0414 220 887",
    stageId: "unconditional",
    daysSinceContact: 3,
    lender: "CBA",
    settlement: "18 Jun",
    avatar: "#c5d4a8",
    brokerId: "rl",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "signed-acceptance"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 815000,
    settledOn: null,
  },
  /* --------------------------------------------------------------------- *
   * B.5 Loan Documents — docs issued by lender, awaiting client signing
   * --------------------------------------------------------------------- */
  {
    id: "l13",
    appRef: "MF-2398",
    name: "Tara Nguyen",
    email: "tara.nguyen@outlook.com",
    phone: "0432 005 117",
    stageId: "loan-docs",
    daysSinceContact: 2,
    lender: "Macquarie",
    settlement: "11 Jun",
    avatar: "#a8d4d4",
    brokerId: "ds",
    associateId: "nn",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "signed-acceptance", "loan-app-pack"],
    pending: ["cert-currency"],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 495000,
    settledOn: null,
  },
  /* --------------------------------------------------------------------- *
   * B.6 Settlement Booked — settlement date locked in
   * --------------------------------------------------------------------- */
  {
    id: "l14",
    appRef: "MF-2392",
    name: "Owen Halloran",
    email: "owen.h@gmail.com",
    phone: "0407 998 220",
    stageId: "settle-booked",
    daysSinceContact: 1,
    lender: "ANZ",
    settlement: "06 Jun",
    avatar: "#c5a8a8",
    brokerId: "na",
    associateId: "nn",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "signed-acceptance", "loan-app-pack", "cert-currency"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 680000,
    settledOn: null,
  },
  /* --------------------------------------------------------------------- *
   * B.7 Settled — populated so Settlements view + Reports KPIs render.
   * Spread across recent weeks + different brokers + different lenders
   * so the chart mixes look right.
   * --------------------------------------------------------------------- */
  {
    id: "l7",
    appRef: "MF-2389",
    name: "Emma & Jack Sullivan",
    email: "e.sullivan@gmail.com",
    phone: "0413 887 224",
    stageId: "settled",
    daysSinceContact: 18,
    lender: "CBA",
    settlement: "12 May",
    avatar: "#d4c5a8",
    brokerId: "mm",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "loan-app-pack", "signed-acceptance", "cert-currency"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 645000,
    settledOn: "2026-05-12",
  },
  {
    id: "l8",
    appRef: "MF-2381",
    name: "Carlos Mendoza",
    email: "carlos.m@hotmail.com",
    phone: "0438 092 113",
    stageId: "settled",
    daysSinceContact: 27,
    lender: "Westpac",
    settlement: "03 May",
    avatar: "#a8c5d4",
    brokerId: "rl",
    associateId: "mp",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "savings", "deposit", "loan-app-pack", "signed-acceptance", "cert-currency"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 410000,
    settledOn: "2026-05-03",
  },
  {
    id: "l9",
    appRef: "MF-2374",
    name: "Aaliyah Singh",
    email: "aaliyah.s@outlook.com",
    phone: "0421 558 740",
    stageId: "settled",
    daysSinceContact: 38,
    lender: "ANZ",
    settlement: "22 Apr",
    avatar: "#c5a8d4",
    brokerId: "na",
    associateId: "nn",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "rentals", "deposit", "loan-app-pack", "signed-acceptance", "cert-currency"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 890000,
    settledOn: "2026-04-22",
  },
  {
    id: "l10",
    appRef: "MF-2368",
    name: "The Bishop Family",
    email: "matt.bishop@gmail.com",
    phone: "0407 991 226",
    stageId: "settled",
    daysSinceContact: 45,
    lender: "NAB",
    settlement: "15 Apr",
    avatar: "#a8d4c5",
    brokerId: "ds",
    associateId: "nn",
    received: ["privacy", "id", "payslips", "pays-yr", "super", "loans", "savings", "deposit", "dependents", "loan-app-pack", "signed-acceptance", "cert-currency"],
    pending: [],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    excludeFromDailyUpdates: false,
    purpose: "unknown",
    conveyancer: null,
    loanAmount: 720000,
    settledOn: "2026-04-15",
  },
];

export const MOCK_DEALS: Deal[] = RAW_MOCK_DEALS.map((d, i) => {
  const leadSource = MOCK_SOURCES[i % MOCK_SOURCES.length];
  const isReferral = leadSource === "Referral";
  const mankinStage: MankinStage = MANKIN_FROM_STAGE[d.stageId];
  // Sprinkle a few priority flags so the Today queue and Overview have
  // representative data on first load.
  const priorityFlag: Deal["priorityFlag"] =
    d.stageId === "settled"
      ? null
      : i % 7 === 0
        ? "outstanding-action"
        : i % 5 === 0
          ? "follow-up"
          : null;
  return {
    ...d,
    secondaryEmail: d.secondaryEmail ?? "",
    // Approximate when the deal entered its current stage from how long
    // it's gone without contact, so the SLA watchlist + stage-velocity
    // views have realistic data. Real Salestrekker deals carry the true
    // stage-move timestamp.
    stageEnteredAt: new Date(Date.now() - (d.daysSinceContact + 1) * 86_400_000),
    // Fixed "date added" — seeded a couple of weeks before the deal's
    // last-contact-derived date so the tracker's Date added column shows
    // realistic, varied dates to sort by on mock data.
    systemAddedAt: new Date(
      Date.now() - (d.daysSinceContact + 14) * 86_400_000,
    ).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }),
    nurturedAt: null,
    nurtureReason: null,
    leadCategory: categoryFor(d.stageId, i),
    leadSource,
    mankinStage,
    priorityFlag,
    comments: null,
    referrer: isReferral ? "Sample Referrer" : null,
    referrerId: null,
    preApprovalDate:
      d.id === "l11" ? "2026-04-01" : d.id === "l2" ? "2026-04-19" : null,
    preApprovalExpiry:
      d.id === "l11" ? "2026-07-01" : d.id === "l2" ? "2026-07-19" : null,
    giftcardSent: isReferral && d.stageId === "settled",
    commission:
      d.stageId === "settled" && d.loanAmount
        ? Math.round(d.loanAmount * 0.0065)
        : null,
    applicants: [
      {
        ...EMPTY_PERSON_DETAILS,
        name: d.name,
        email: d.email,
        phone: d.phone,
      },
    ],
    guarantors: [],
  };
});

/**
 * Email templates. Ported from
 * design_handoff_lead_followup/design/components/templates.jsx (Email · 4 templates).
 *
 * Copy is verbatim from the design with merge tokens swapped for runtime
 * substitution. Tone selector (warm/firm/final) picks between Templates 02/03/04
 * inside the path-to-options or path-to-lodgement family.
 */

import { stageMeta, type Deal } from "@/lib/clients/salestrekker/types";
import { docNameForEmail } from "@/lib/clients/salestrekker/doc-catalog";
import { teamMember, type TeamMemberId } from "@/lib/team";
import { DOC_RULES, type ConfiguratorDoc } from "@/lib/doc-rules";
import {
  dealFollowUpSubject,
  dealGreetingFirstName,
  subjectWithMankin,
} from "@/lib/deal-subjects";
import { customerClosingFor } from "@/lib/customer-closing";
import { formatDateAU, formatTimestampAU } from "@/lib/format-date";

export type Tone = "warm" | "firm" | "final";

interface TemplateContext {
  deal: Deal;
  /** Broker the email is from (usually currentBroker.short). */
  brokerShort: string;
  brokerPhone: string;
  /** TEAM id of the broker. Used to look up their calendar bookingUrl
   *  so the closing line can point the customer to it. Optional - omit
   *  and the closing falls back to "give me a call". */
  brokerId?: string;
  /** Whether this is the first outbound email to the customer. Drives
   *  the "Deal Enquiry:" vs "Deal Update:" subject prefix. Callers
   *  normally pass false; the server action overrides to true after
   *  checking activity history. */
  isFirstContact?: boolean;
  /** Customer's secure portal link. When set, doc-chase follow-ups append
   *  an "upload here" line so the customer can click straight through
   *  instead of hunting for the original portal email. */
  portalUrl?: string;
}

/** Append the secure-upload portal line directly after a document list, so
 *  the customer sees where to send the docs before the sign-off. Returns the
 *  text unchanged when no link is available. Matches the AI-draft wording
 *  (lib/claude-drafts.ts) so the template and Claude paths read identically. */
function withPortalLine(docList: string, portalUrl: string | undefined): string {
  if (!portalUrl) return docList;
  return `${docList}\n\nYou can upload everything securely through your portal here:\n${portalUrl}`;
}

interface ComposedEmail {
  subject: string;
  body: string;
}

/**
 * The standard "get started" ask — applicant details. Shared verbatim by
 * the initial outreach and any documents-list email so a customer is always
 * asked for these details on a first-time communication, not just the very
 * first email. Wording supplied by Mankin; keep it as-is.
 */
const DETAILS_REQUEST_ASK = `In order to begin, could you please provide the following details for all applicants:

• Full names including middle names
• Date of birth
• Addresses
• Email addresses
• Contact number`;

/**
 * The privacy-form explanation. Only used where the privacy form hasn't
 * been sent yet (the initial outreach). The documents-list email already
 * lists the signed privacy form, so it drops this to avoid contradicting
 * itself.
 */
const PRIVACY_FORM_NOTE = `This will allow us to send through a privacy form for you to E-sign. This form is to ensure that all things we discuss remain confidential between yourself, and our brokerage. It gives us the green light to look into your credit solutions. Just note when we send this through it may end up in your spam/ junk folder so please check this.`;

function outstandingBullets(deal: Deal): string {
  const lines = [
    ...deal.overdue.map((id) => `• ${docNameOrUnknown(deal, id)}`),
    ...deal.pending.map((id) => `• ${docNameOrUnknown(deal, id)}`),
    ...deal.advisory.map((a) => `• ${docNameOrUnknown(deal, a.id)} (${a.note})`),
  ];
  return lines.join("\n");
}

function firstName(deal: Deal): string {
  // Joint-applicant aware: returns "Sarah and Tom" instead of just
  // "Sarah" when the deal has two applicants captured.
  return dealGreetingFirstName(deal);
}

function lenderShort(deal: Deal): string {
  return deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");
}

/** The lender's real display name, or null when it's still a placeholder
 *  ("TBC", "Comparing N options", blank). Keeps customer copy from ever
 *  reading "your application with Comparing 3 options". */
function realLender(deal: Deal): string | null {
  const name = lenderShort(deal).trim();
  if (!name || name.startsWith("TBC") || name.startsWith("Comparing")) {
    return null;
  }
  return name;
}

/** " with Westpac", or "" when no lender is chosen yet. */
function withLenderPhrase(deal: Deal): string {
  const name = realLender(deal);
  return name ? ` with ${name}` : "";
}

/** The booked settlement date, or null when it's still a placeholder
 *  ("TBD", "TBC", blank) that shouldn't read as "settlement on TBD". */
function settlementOrNull(deal: Deal): string | null {
  const s = deal.settlement?.trim();
  if (!s || s.toUpperCase() === "TBD" || s.toUpperCase() === "TBC") return null;
  return s;
}

function subjectFor(ctx: TemplateContext): string {
  return dealFollowUpSubject(ctx.deal, ctx.isFirstContact === true);
}

/** Warm follow-up. Template 02 / 03 (depending on phase). */
function composeWarm(ctx: TemplateContext): ComposedEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  const meta = stageMeta(deal.stageId);
  const closing = customerClosingFor({ brokerId: ctx.brokerId });

  /* No portal configured yet — send a general touch-base rather than
     a doc-chase with an empty list. */
  const hasOutstanding =
    deal.pending.length > 0 || deal.overdue.length > 0;
  if (!hasOutstanding) {
    return {
      subject: subjectFor(ctx),
      body: `Hi ${firstName(deal)},

I wanted to check in on your home loan and make sure nothing on my end is holding you up.

Whenever you're ready for the next step, just reply here or give me a call on ${brokerPhone}, and I'll walk you through exactly what we need to get your application underway.

There's no rush at all. I'm here whenever the timing suits you.

${closing}

Talk soon,
${brokerShort}`,
    };
  }

  if (meta.phase === 1) {
    return {
      subject: subjectFor(ctx),
      body: `Hi ${firstName(deal)},

We're close on your application. A few items are still outstanding, and the moment they're in I can move things forward${withLenderPhrase(deal)} the same day.

Still to come:
${withPortalLine(outstandingBullets(deal), ctx.portalUrl)}

Whatever's easiest for you:
• Reply with the files attached and I'll upload them for you
• Take a photo on your phone and text it to ${brokerPhone}
• Book a quick 15-minute call if anything's hard to find

No pressure at all. If any of these are tricky to get hold of, tell me and we'll work around it together.

${closing}

Talk soon,
${brokerShort}`,
    };
  }

  const chosen = realLender(deal);
  const lodgeOpener = chosen
    ? `Good news: you've chosen ${chosen} and we're ready to lodge.`
    : `Good news: we're ready to lodge your application.`;
  const settle = settlementOrNull(deal);
  const settleLine = settle
    ? `With settlement set for ${settle}, the sooner these reach me the better. Once they're in, I can have your application lodged the same day.`
    : `The sooner these reach me, the better. Once they're in, I can have your application lodged the same day.`;
  return {
    subject: subjectFor(ctx),
    body: `Hi ${firstName(deal)},

${lodgeOpener} There are just a couple of items to tie off before I can submit your file.

Still to come:
${withPortalLine(outstandingBullets(deal), ctx.portalUrl)}

${settleLine}

${closing}

Talk soon,
${brokerShort}`,
  };
}

/** Firm follow-up. Sits between warm and final. */
function composeFirm(ctx: TemplateContext): ComposedEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  const meta = stageMeta(ctx.deal.stageId);
  const closing = customerClosingFor({ brokerId: ctx.brokerId });

  if (meta.phase === 1) {
    return {
      subject: subjectFor(ctx),
      body: `Hi ${firstName(deal)},

We're about a week in now, and a few items are still holding up your application. To move ahead with your assessment${realLender(deal) ? ` for ${realLender(deal)}` : ""}, I'll need:

${withPortalLine(outstandingBullets(deal), ctx.portalUrl)}

If the portal is fiddly, just reply with the files attached and I'll upload them for you, or text them to ${brokerPhone}.

If anything's proving hard to get, let me know and we'll sort it together. The sooner we close this out, the sooner I can come back to you with your options.

${closing}

Cheers,
${brokerShort}`,
    };
  }

  const settle = settlementOrNull(deal);
  const firmOpener = settle
    ? `Settlement on ${settle} is close now, and a few items are still outstanding before I can keep things on schedule:`
    : `We're into the final stretch, and a few items are still outstanding before I can keep things moving:`;
  return {
    subject: subjectFor(ctx),
    body: `Hi ${firstName(deal)},

${firmOpener}

${withPortalLine(outstandingBullets(deal), ctx.portalUrl)}

If any of these are hard to get to, call me on ${brokerPhone} and we'll work out the quickest way around it.

${closing}

Cheers,
${brokerShort}`,
  };
}

/** Final notice. Template 04. */
function composeFinal(ctx: TemplateContext): ComposedEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  const settle = settlementOrNull(deal);
  const openLine = settle
    ? `We're now ${deal.daysSinceContact} days past our original timeline, and your settlement on ${settle} is becoming difficult to hold.`
    : `We're now ${deal.daysSinceContact} days past our original timeline, and the delay is starting to put your application at risk.`;

  return {
    subject: subjectFor(ctx),
    body: `Hi ${firstName(deal)},

I wanted to write to you personally. ${openLine}

Still outstanding:
${withPortalLine(outstandingBullets(deal), ctx.portalUrl)}

If something's making these hard to track down, please just call me. Even a five-minute conversation will get us moving again. If it's a question of timing, ${realLender(deal) ?? "your lender"} may be able to extend, though I'd need to request that with them this week.

I'd genuinely rather not see you lose this. Let's talk it through.

${brokerPhone}

Regards,
${brokerShort}`,
  };
}

/**
 * Initial outreach email sent right after the deal is created.
 * Asks the customer for personal details so the privacy form can be issued.
 * Copy matches the Mankin standard spiel.
 */
/**
 * Starter document list for the initial email when the deal has no checklist
 * configured yet (the usual case at first contact, before a portal template
 * is set up). The list is different per loan type — a refinance, an SMSF
 * purchase and a construction loan need different things — so it's built from
 * the same DOC_RULES the portal configurator uses, keyed off the deal's lead
 * category. Once the broker configures the full template, the deal's own
 * checklist takes over. Brokers can trim the list in the composer either way.
 */
function starterDocsForCategory(category: string): string[] {
  const common = [...DOC_RULES.base, ...DOC_RULES.payg];
  let docs: ConfiguratorDoc[];
  switch (category) {
    case "refinance":
      docs = [...common, ...DOC_RULES.refinancer];
      break;
    case "smsf":
      docs = [...DOC_RULES.base, ...DOC_RULES.smsf];
      break;
    case "construction":
      docs = [...common, ...DOC_RULES.construction];
      break;
    default:
      // purchase, business, asset, unknown — the common core.
      docs = common;
  }
  return docs.map((d) => `• ${d.name}`);
}

export function composeInitialEmail(ctx: Pick<TemplateContext, "deal" | "brokerShort" | "brokerPhone">): ComposedEmail {
  const { deal, brokerShort, brokerPhone } = ctx;
  const first = firstName(deal);

  // Documents list, appended so the first email covers both the intro and
  // what we'll need — no more sending a second "here are the documents"
  // email. Prefer the deal's own checklist when it's been set up; otherwise
  // fall back to the standard starter list. The whole body is editable, so
  // a broker can trim either half before sending.
  const dealDocLines = outstandingBullets(deal);
  const docList = dealDocLines || starterDocsForCategory(deal.leadCategory).join("\n");

  return {
    subject: subjectWithMankin("Getting started", deal),
    body: `Hi ${first},

As discussed, I would love to help you with the next steps of obtaining finance.

${DETAILS_REQUEST_ASK}

${PRIVACY_FORM_NOTE}

To help things move quickly, it is also worth starting to gather the following documents for all applicants:

${docList}

There is no need to have everything at once. Send through what you can and we will let you know if anything else is needed.

Talk soon,
${brokerShort}

${brokerShort} · Mankin Finance
${brokerPhone}`,
  };
}

export function composeFollowUp(tone: Tone, ctx: TemplateContext): ComposedEmail {
  switch (tone) {
    case "warm":
      return composeWarm(ctx);
    case "firm":
      return composeFirm(ctx);
    case "final":
      return composeFinal(ctx);
  }
}

/**
 * Pre-approval renewal request. Sent when the deal's pre-approval has
 * expired or is within 21 days of expiry. Lists the documents the lender
 * needs for reissuance so the customer can start gathering them immediately.
 */
export function composePreApprovalRenewal(
  ctx: TemplateContext & { expiryDate: string },
): ComposedEmail {
  const { deal, brokerShort, expiryDate } = ctx;
  const first = firstName(deal);
  const closing = customerClosingFor({ brokerId: ctx.brokerId });
  const expiry = formatDateAU(expiryDate);
  const isExpired = new Date(expiryDate) < new Date();
  const lenderName =
    deal.lender && !deal.lender.startsWith("TBC") && !deal.lender.startsWith("Comparing")
      ? lenderShort(deal)
      : null;
  const withLender = lenderName ? ` with ${lenderName}` : "";

  const intro = isExpired
    ? `Your pre-approval${withLender} expired on ${expiry}. To keep your property search on track, we need to renew it as soon as possible.`
    : `Your pre-approval${withLender} is due to expire on ${expiry}. To make sure there is no gap when you find the right property, it is best to start the renewal now.`;

  const taxNote = isExpired
    ? "\n- If more than 12 months have passed since your most recent tax return was lodged, an updated return may also be required by the lender."
    : "";

  const renewalDocs = `- 2 most recent payslips
- Last 3 months of bank statements (all accounts used for savings and everyday spending)
- A letter of employment confirming your current role, start date, and salary${taxNote}`;

  return {
    subject: subjectWithMankin("Pre-approval renewal", deal),
    body: `Hi ${first},

${intro}

To renew, the lender will need a fresh set of supporting documents. Could you please get the following together for all applicants:

${withPortalLine(renewalDocs, ctx.portalUrl)}

If anything on that list is difficult to get hold of, just reply and let me know and we will find a way to work around it.

${closing}

Talk soon,
${brokerShort}`,
  };
}

/**
 * Convenience: pre-canned context from a deal + the broker assigned to it.
 * Phase 4 swaps brokerPhone for a real lookup table.
 */
const BROKER_PHONES: Record<string, string> = {
  mm: "0420 699 983",
  na: "0420 699 991",
  rl: "0420 699 992",
  ds: "0420 699 993",
};

export function contextForDeal(deal: Deal): TemplateContext {
  const broker = teamMember(deal.brokerId as TeamMemberId);
  return {
    deal,
    brokerId: broker.id,
    brokerShort: broker.short,
    brokerPhone: BROKER_PHONES[broker.id] ?? "0420 699 983",
  };
}

/* -------------------------------------------------------------------------- */
/* Portal welcome email                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The customer's first email after the broker creates the application.
 * Introduces the portal, links to it, lists the docs we need, and gives
 * them a way to reply if anything's missing. Sent via Outlook from the
 * broker's mailbox so replies thread back to them.
 */
export function composePortalWelcomeEmail(args: {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
  portalUrl: string;
  expiresAt: string;
}): ComposedEmail {
  const { deal, brokerShort, brokerPhone, portalUrl, expiresAt } = args;
  const first = firstName(deal);
  const expiry = formatTimestampAU(expiresAt);

  // Doc list — preferred order: overdue, pending, advisory (with note),
  // then any custom-added docs the broker tacked on.
  const lines: string[] = [];
  for (const id of deal.overdue) lines.push(`• ${docNameOrUnknown(deal, id)}`);
  for (const id of deal.pending) lines.push(`• ${docNameOrUnknown(deal, id)}`);
  for (const a of deal.advisory) lines.push(`• ${docNameOrUnknown(deal, a.id)} (${a.note})`);
  const bullets = lines.length > 0
    ? lines.join("\n")
    : "• We'll add the document list to the portal shortly";

  /* Customer's first email from us. Kept tight: warm greeting, the
     link, what we need. Phone + sign-off come from the auto-appended
     HTML signature so we don't repeat them in the body. */
  void brokerPhone;
  return {
    subject: subjectWithMankin("Welcome to your portal", deal),
    body: `Hi ${first},

Lovely to be working with you. I've set up a secure document portal for your application:

${portalUrl}

The link is unique to you and expires on ${expiry}. First visit you'll be asked for a one-time code (SMS or email) so we know it's the right person.

${DETAILS_REQUEST_ASK}

What we need from you:
${bullets}

You can upload straight from the portal (phone or laptop), or reply to this email with the files attached and I'll do it on your end.

Talk soon,
${brokerShort}`,
  };
}

/** Doc name lookup for email doc lists. Handles broker-added custom docs
 *  and appends the privacy form's spam-folder reminder (see
 *  docNameForEmail). Always a string. */
function docNameOrUnknown(deal: Deal, id: string): string {
  return docNameForEmail(deal.customDocs, id);
}

/* -------------------------------------------------------------------------- */
/* Customer details edit notification — broker is told what changed          */
/* -------------------------------------------------------------------------- */

interface DetailsSnapshot {
  applicants: Array<{ name: string; email: string; phone: string }>;
  guarantors: Array<{ name: string; email: string; phone: string; relationship: string | null }>;
}

/**
 * Customer used the "Edit my details" affordance on the portal. We email
 * the broker a side-by-side diff so they can validate the change before
 * the next follow-up goes out (especially important when the customer
 * fixes an email — old portal emails are stale once the address changes).
 */
export function composeCustomerDetailsChangedEmail(args: {
  deal: Deal;
  before: DetailsSnapshot;
  after: DetailsSnapshot;
  dashboardUrl: string;
}): ComposedEmail {
  const { deal, before, after, dashboardUrl } = args;

  const lines: string[] = [
    `${deal.name} just edited their contact details on the portal.`,
    "",
    "Changes:",
  ];

  // Applicant-by-applicant diff.
  const appCount = Math.max(before.applicants.length, after.applicants.length);
  for (let i = 0; i < appCount; i++) {
    const b = before.applicants[i];
    const a = after.applicants[i];
    if (!a) {
      lines.push(`  Applicant ${i + 1}: removed`);
      continue;
    }
    if (!b) {
      lines.push(`  Applicant ${i + 1}: added`);
      lines.push(`    Name:  ${a.name}`);
      lines.push(`    Email: ${a.email || "(none)"}`);
      lines.push(`    Phone: ${a.phone || "(none)"}`);
      continue;
    }
    const fieldDiffs: string[] = [];
    if (b.name !== a.name) fieldDiffs.push(`    Name:  ${b.name || "(blank)"}  →  ${a.name || "(blank)"}`);
    if (b.email !== a.email) fieldDiffs.push(`    Email: ${b.email || "(blank)"}  →  ${a.email || "(blank)"}`);
    if (b.phone !== a.phone) fieldDiffs.push(`    Phone: ${b.phone || "(blank)"}  →  ${a.phone || "(blank)"}`);
    if (fieldDiffs.length > 0) {
      lines.push(`  Applicant ${i + 1} (${a.name || b.name}):`);
      lines.push(...fieldDiffs);
    }
  }

  // Guarantor-by-guarantor diff.
  const gCount = Math.max(before.guarantors.length, after.guarantors.length);
  for (let i = 0; i < gCount; i++) {
    const b = before.guarantors[i];
    const a = after.guarantors[i];
    if (!a) {
      lines.push(`  Guarantor ${i + 1}: removed`);
      continue;
    }
    if (!b) {
      lines.push(`  Guarantor ${i + 1}: added`);
      lines.push(`    Name:  ${a.name}`);
      lines.push(`    Email: ${a.email || "(none)"}`);
      lines.push(`    Phone: ${a.phone || "(none)"}`);
      lines.push(`    Relationship: ${a.relationship || "(not specified)"}`);
      continue;
    }
    const fieldDiffs: string[] = [];
    if (b.name !== a.name) fieldDiffs.push(`    Name:  ${b.name || "(blank)"}  →  ${a.name || "(blank)"}`);
    if (b.email !== a.email) fieldDiffs.push(`    Email: ${b.email || "(blank)"}  →  ${a.email || "(blank)"}`);
    if (b.phone !== a.phone) fieldDiffs.push(`    Phone: ${b.phone || "(blank)"}  →  ${a.phone || "(blank)"}`);
    if (b.relationship !== a.relationship) {
      fieldDiffs.push(
        `    Relationship: ${b.relationship || "(none)"}  →  ${a.relationship || "(none)"}`,
      );
    }
    if (fieldDiffs.length > 0) {
      lines.push(`  Guarantor ${i + 1} (${a.name || b.name}):`);
      lines.push(...fieldDiffs);
    }
  }

  lines.push("");
  lines.push("Heads up: if the email changed, any portal links you sent to the old address are now going to the wrong inbox. Issue a fresh link from the deal drawer so it lands at the new address.");
  lines.push("");
  lines.push(`Open the deal: ${dashboardUrl}`);
  lines.push("");
  lines.push("- Mankin Finance portal (automated notification)");

  const tag = deal.appRef ? ` · ${deal.appRef}` : "";
  return {
    subject: `[Mankin Portal${tag}] ${deal.name} updated their contact details`,
    body: lines.join("\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* Customer flagged a doc as "can't upload" — broker sees the reason         */
/* -------------------------------------------------------------------------- */

/**
 * Fires the moment a customer taps "I can't upload this" on the portal
 * and submits a reason. Goes to the assigned broker (and CCs associate
 * when set). Keeps the same `[Mankin Portal · MF-NNNN]` inbox-triage
 * prefix as upload notifications so the broker can filter both kinds
 * of customer-initiated comms in one go.
 */
export function composeDocFlaggedEmail(args: {
  deal: Deal;
  docName: string;
  reasonLabel: string;
  explanation: string;
  dashboardUrl: string;
}): ComposedEmail {
  const { deal, docName, reasonLabel, explanation, dashboardUrl } = args;
  const tag = deal.appRef ? ` · ${deal.appRef}` : "";

  const lines: string[] = [
    `${deal.name} flagged a document on the portal. They can't upload it.`,
    "",
    `Document: ${docName}`,
    `Reason: ${reasonLabel}`,
    "",
    "Their explanation:",
    explanation.trim() || "(no explanation provided)",
    "",
    "Action options:",
    "  • Reply to the customer and help them get it across",
    "  • Mark the doc N/A on the deal drawer if their reason is valid",
    "  • Override and leave the doc outstanding if you still need it",
    "",
    `Open the deal: ${dashboardUrl}`,
    "",
    "- Mankin Finance portal (automated notification)",
  ];

  return {
    subject: `[Mankin Portal${tag}] ${deal.name} can't upload ${docName}`,
    body: lines.join("\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* Portal upload notification — broker sees what the customer sent in        */
/* -------------------------------------------------------------------------- */

/**
 * Fires the moment a customer uploads a doc through the portal. Goes to
 * the assigned broker (and optionally their associate). Subject includes
 * the deal appRef so Outlook conversation view threads every upload for
 * the same deal under one header.
 *
 * Sent via app-only Microsoft Graph (no broker session is active for a
 * customer-initiated request).
 */
export function composePortalUploadNotificationEmail(args: {
  deal: Deal;
  docName: string;
  filename: string;
  fileSizeBytes: number;
  sharepointUrl: string | null;
  sharepointFolder: string;
  dashboardUrl: string;
  /** Total docs still outstanding on the deal AFTER this upload. Helps
   *  the broker see "3 to go" at a glance. */
  outstandingCountAfter: number;
}): ComposedEmail {
  const {
    deal,
    docName,
    filename,
    fileSizeBytes,
    sharepointUrl,
    sharepointFolder,
    dashboardUrl,
    outstandingCountAfter,
  } = args;

  const sizeKb = (fileSizeBytes / 1024).toFixed(1);
  const tag = deal.appRef ? ` · ${deal.appRef}` : "";
  const customerName = deal.name;

  const lines: string[] = [
    `${customerName} just uploaded a document through their portal.`,
    "",
    `Document: ${docName}`,
    `File: ${filename} (${sizeKb} KB)`,
    `Folder: Deal applications/${sharepointFolder}`,
  ];
  if (sharepointUrl) {
    lines.push(`Open in SharePoint: ${sharepointUrl}`);
  }
  lines.push("");
  if (outstandingCountAfter === 0) {
    lines.push("That was the last one. The doc checklist is now complete.");
  } else {
    lines.push(
      `${outstandingCountAfter} doc${outstandingCountAfter === 1 ? "" : "s"} still outstanding.`,
    );
  }
  lines.push("");
  lines.push(`Open the deal: ${dashboardUrl}`);
  lines.push("");
  lines.push("- Mankin Finance portal (automated notification)");

  return {
    subject: `[Mankin Portal${tag}] ${customerName} uploaded ${docName}`,
    body: lines.join("\n"),
  };
}

/**
 * Automated nudge email sent to a customer who received a portal link
 * but has not uploaded any documents within 3 days. Sent by the daily
 * portal-reminders cron via Outlook app-only Graph send.
 */
export function composeDocNudgeEmail(ctx: {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
  portalUrl: string;
}): ComposedEmail {
  const { deal, brokerShort, brokerPhone, portalUrl } = ctx;
  const first = firstName(deal);
  return {
    subject: subjectWithMankin("Documents reminder", deal),
    body: `Hi ${first},

Just following up on the documents needed for your application.

Your secure upload link is still active:
${portalUrl}

It only takes a few minutes. If you are having trouble tracking something down, give me a call on ${brokerPhone} or reply to this email and we will figure it out.

Talk soon,
${brokerShort}

${brokerShort} · Mankin Finance
${brokerPhone}`,
  };
}

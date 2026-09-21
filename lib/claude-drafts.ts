import "server-only";
import { chatComplete } from "@/lib/clients/claude";
import { stageMeta, type Deal } from "@/lib/clients/salestrekker/types";
import { docNameForEmail } from "@/lib/clients/salestrekker/doc-catalog";
import {
  dealEnquirySubject,
  dealUpdateSubject,
  dealGreetingFirstName,
} from "@/lib/deal-subjects";

/**
 * Claude-drafted follow-up emails + SMS.
 *
 * Builds a structured prompt from the deal context and asks Claude to
 * write the chase. Output respects Mankin's brand voice rules:
 *   • Plain Australian English (no Americanisms like "reach out")
 *   • No exclamation marks
 *   • Never the word "happy"
 *   • Tone matches the broker's selection (warm / firm / final)
 *
 * Mock mode (MOCK_CHAT default-true) returns a deterministic draft
 * derived from the deal, so the UX works without burning API credits.
 *
 * The model output is parsed for a single "Subject: …" line on top
 * (email) or returned verbatim (SMS). If the parse fails we fall back
 * to the channel-appropriate generic subject.
 */

export type DraftTone = "warm" | "firm" | "final";
export type DraftChannel = "email" | "sms";

export interface DraftInput {
  deal: Deal;
  channel: DraftChannel;
  tone: DraftTone;
  brokerShort: string;
  brokerPhone: string;
  /** Whether any prior outbound contact exists for this deal. Drives
   *  the email subject prefix ("Deal Enquiry:" vs "Deal Update:") and
   *  is also passed into Claude's prompt so it phrases the opening
   *  accordingly. Defaults to false at the server-action layer. */
  isFirstContact?: boolean;
  /** Customer portal URL to invite the customer to upload through. Only
   *  set for email drafts that have outstanding documents. The URL is
   *  inserted deterministically (never typed by the model) so a long
   *  signed token can't be mangled. Absent → no link in the draft. */
  portalUrl?: string;
}

export interface DraftedFollowUp {
  subject: string;
  body: string;
  /** Whether the response came from Claude or the local fallback. */
  source: "anthropic" | "mock";
}

/* -------------------------------------------------------------------------- */
/* System prompt + context builder                                            */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `You are a writing assistant for Mankin Finance, a small Australian mortgage brokerage in Oran Park, NSW.

Your job: draft brief, professional follow-up messages from a broker to a customer chasing outstanding documents or status updates. The broker reviews and sends. Never edit on their behalf.

VOICE RULES (enforce strictly):
- Plain Australian English. No Americanisms ("reach out", "circle back", "touch base"). Use "follow up", "get back to you", "let me know" instead.
- No exclamation marks anywhere. Use full stops.
- NEVER use em dashes (Unicode U+2014) anywhere in your output. This includes the character that looks like a long dash. Replace with a hyphen, a full stop, a comma, a colon, a semicolon, or parentheses. Check every line of your output for this character before responding.
- Never the word "happy" in any form. Use "glad", "pleased", "good to" instead.
- Use Australian spellings (organise, finalise, recognise, programme).
- First person singular if the broker is signing. Polite but direct.

OUTPUT FORMAT:
- For EMAIL: start with one line "Subject: <subject>" then a blank line, then the body. The subject line will be supplied to you by the caller as SUBJECT_OVERRIDE; copy it verbatim. Body in plain text. No markdown.
- For SMS: a single message under 320 characters. No subject line. No greeting needed beyond the first name.

TONE LADDER:
- warm: friendly check-in, no pressure. Offer help if anything's stuck.
- firm: clear deadline, lender impact explained, single ask.
- final: blunt, factual, escalates the consequence (deal may stall). Still respectful.`;

function buildUserPrompt(input: DraftInput): string {
  const { deal, channel, tone, brokerShort, brokerPhone } = input;
  const meta = stageMeta(deal.stageId);

  const overdueDocs = deal.overdue.map((id) => docNameForEmail(deal.customDocs, id));
  const pendingDocs = deal.pending.map((id) => docNameForEmail(deal.customDocs, id));
  const advisoryItems = deal.advisory.map((a) => ({
    name: docNameForEmail(deal.customDocs, a.id),
    state: a.state,
    note: a.note,
  }));

  const firstName = dealGreetingFirstName(deal);
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");

  /* Keep the JSON compact: Claude is efficient at parsing nested fields. */
  const context = {
    customer: { firstName, fullName: deal.name },
    deal: {
      appRef: deal.appRef,
      stage: meta.label,
      stageGoal: meta.goal,
      lender: lenderShort,
      daysSinceContact: deal.daysSinceContact,
      settlementDate: deal.settlement,
    },
    docs: {
      received: deal.received.length,
      overdue: overdueDocs,
      pending: pendingDocs,
      advisory: advisoryItems,
    },
    broker: {
      short: brokerShort,
      phone: brokerPhone,
    },
  };

  const subjectOverride =
    channel === "email"
      ? input.isFirstContact === true
        ? dealEnquirySubject(deal)
        : dealUpdateSubject(deal)
      : "";

  const channelInstruction =
    channel === "email"
      ? `Write an email. Start with "Subject: ${subjectOverride}" on the first line (copy that subject verbatim, do not change it), then a blank line, then the body.`
      : `Write a single SMS under 320 characters. Keep it tight. No subject line.`;

  return [
    channelInstruction,
    `Tone: ${tone}.`,
    input.isFirstContact === true
      ? "This is the FIRST outbound contact for this deal. Introduce yourself briefly and frame the email as an initial enquiry, not a follow-up."
      : "This is a follow-up. You have spoken to them before. Don't reintroduce yourself.",
    `Customer first name: ${firstName}.`,
    `Sign off: ${brokerShort}, Mankin Finance, ${brokerPhone}.`,
    "",
    "Context (JSON):",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "Constraints:",
    `- Reference the lender (${lenderShort || "their chosen lender"}) and outstanding items by name where relevant.`,
    `- Don't mention things that aren't in the context.`,
    `- Don't repeat the customer's last name (Australians use first name only in this context).`,
    overdueDocs.length > 0
      ? `- The overdue docs are the priority: ${overdueDocs.join(", ")}.`
      : pendingDocs.length > 0
        ? `- Outstanding requests: ${pendingDocs.join(", ")}.`
        : `- No outstanding docs. This is a status check / cadence touch.`,
    `- ${tone === "final" ? "Mention that delays risk pushing back settlement." : tone === "firm" ? "Set a clear next step + when you need it by." : "Keep the energy light, offer to call if easier."}`,
    // Portal link: give the model a placeholder, never the URL itself, so
    // the signed token can't be reworded or truncated. Filled in after.
    input.portalUrl
      ? `- Invite them to upload the outstanding documents through their secure portal. Write a short lead-in line, then put the exact placeholder {{PORTAL_LINK}} on its own line for the link. Do not write any URL yourself.`
      : "",
    "",
    "Output now:",
  ]
    .filter(Boolean)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Mock fallback (no API key required)                                         */
/* -------------------------------------------------------------------------- */

function mockDraft(input: DraftInput): DraftedFollowUp {
  const { deal, channel, tone, brokerShort, brokerPhone } = input;
  const firstName = dealGreetingFirstName(deal);
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");
  const outstanding = [...deal.overdue, ...deal.pending].slice(0, 3).map((id) => docNameForEmail(deal.customDocs, id));

  if (channel === "sms") {
    if (outstanding.length === 0) {
      return {
        subject: "",
        body: `Hi ${firstName}, quick check-in on your application with ${lenderShort || "the lender"}. Everything looks good our end. Let me know if you have any questions.\n\n${brokerShort}`,
        source: "mock",
      };
    }
    const docList = outstanding.length === 1 ? outstanding[0] : `${outstanding.slice(0, -1).join(", ")} and ${outstanding[outstanding.length - 1]}`;
    if (tone === "final") {
      return {
        subject: "",
        body: `Hi ${firstName}, still waiting on ${docList}. Without these we can't progress with ${lenderShort || "the lender"} and settlement risks being delayed. Can you get them across today?\n\n${brokerShort}, ${brokerPhone}`,
        source: "mock",
      };
    }
    if (tone === "firm") {
      return {
        subject: "",
        body: `Hi ${firstName}, just chasing ${docList} so we can keep your application moving with ${lenderShort || "the lender"}. Could you send them through by end of week? Call me on ${brokerPhone} if anything's tricky.\n\n${brokerShort}`,
        source: "mock",
      };
    }
    return {
      subject: "",
      body: `Hi ${firstName}, just a friendly nudge for ${docList} when you get a moment. Let me know if anything's giving you trouble.\n\n${brokerShort}, ${brokerPhone}`,
      source: "mock",
    };
  }

  /* Email branch. Subject uses Mankin's canonical convention:
     "Deal Enquiry:" on first contact, "Deal Update:" thereafter. */
  const subject = input.isFirstContact === true
    ? dealEnquirySubject(deal)
    : dealUpdateSubject(deal);

  let body = `Hi ${firstName},\n\n`;
  if (outstanding.length === 0) {
    body += `Just a quick check-in on your application with ${lenderShort || "the lender"}. Everything looks good from our end. We will let you know as soon as the next milestone lands.\n\nIf anything's changed or you have questions, give me a call on ${brokerPhone}.\n\nKind regards,\n${brokerShort}\nMankin Finance`;
  } else {
    body += `I'm following up on the documents we're still waiting on:\n\n${outstanding.map((d) => `  • ${d}`).join("\n")}\n\n`;
    if (tone === "final") {
      body += `Without these we can't progress with ${lenderShort || "the lender"}, and your settlement may be pushed back. Could you get them across today? If anything is blocking you, please call me on ${brokerPhone} and we will sort it.`;
    } else if (tone === "firm") {
      body += `So we can keep your application moving with ${lenderShort || "the lender"}, could you send these through by end of week? If something's tricky to find I am glad to talk it through. Call me on ${brokerPhone}.`;
    } else {
      body += `No urgency, just keeping the file moving along with ${lenderShort || "the lender"}. Send them through whenever you get a chance, and let me know if you hit any snags.`;
    }
    // Secure upload link sits just above the sign-off, where the customer
    // is looking after reading what's outstanding.
    if (input.portalUrl) {
      body += `\n\nYou can upload everything securely through your portal here:\n${input.portalUrl}`;
    }
    body += `\n\nKind regards,\n${brokerShort}\nMankin Finance`;
  }

  return { subject, body, source: "mock" };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a follow-up draft. Returns { subject, body, source }.
 *
 * The source field tells the UI whether Claude wrote it ("anthropic")
 * or it came from the local heuristic ("mock") — useful for both
 * audit trails + a small visible indicator while we're in mock mode.
 */
export async function draftFollowUp(input: DraftInput): Promise<DraftedFollowUp> {
  const userPrompt = buildUserPrompt(input);

  // Short-circuit when no API key — the chatComplete client returns
  // mock anyway, but we want a domain-aware mock here that knows
  // about subjects + multi-paragraph body structure.
  if (process.env.MOCK_CHAT !== "false" || !process.env.ANTHROPIC_API_KEY) {
    return mockDraft(input);
  }

  const result = await chatComplete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const parsed = parseModelOutput(result.text, input.channel);
  if (!parsed) {
    // Claude returned something we can't parse — degrade to template.
    return mockDraft(input);
  }

  return {
    ...parsed,
    body: fillPortalLink(parsed.body, input.portalUrl),
    source: "anthropic",
  };
}

/**
 * Swap the {{PORTAL_LINK}} placeholder for the real URL. If the model
 * dropped the placeholder, append the link as a fallback so an email
 * meant to carry it never goes out without one. With no URL, strip any
 * stray placeholder so it can never reach the customer.
 */
function fillPortalLink(body: string, portalUrl?: string): string {
  const PLACEHOLDER = "{{PORTAL_LINK}}";
  // Literal split/join, not RegExp — the braces in the placeholder are
  // regex quantifier syntax and would need escaping.
  if (!portalUrl) {
    return body.split(PLACEHOLDER).join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (body.includes(PLACEHOLDER)) {
    return body.split(PLACEHOLDER).join(portalUrl);
  }
  return `${body.trimEnd()}\n\nYou can upload everything securely through your portal here:\n${portalUrl}`;
}

function parseModelOutput(
  text: string,
  channel: DraftChannel,
): { subject: string; body: string } | null {
  if (!text) return null;
  const trimmed = text.trim();

  if (channel === "sms") {
    // SMS is a single message — clip to 600 chars defensively.
    return { subject: "", body: trimmed.slice(0, 600) };
  }

  // Email — pull the first "Subject:" line off the top.
  const lines = trimmed.split(/\r?\n/);
  let subjectIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const m = /^subject\s*:\s*(.+)$/i.exec(lines[i]);
    if (m) {
      subjectIdx = i;
      break;
    }
  }
  if (subjectIdx === -1) {
    // No subject line — treat the whole thing as the body with a fallback subject.
    return { subject: "Follow-up on your application", body: trimmed };
  }

  const subject = (/^subject\s*:\s*(.+)$/i.exec(lines[subjectIdx])?.[1] ?? "").trim();
  const body = lines
    .slice(subjectIdx + 1)
    .join("\n")
    .replace(/^\s*\n+/, "") // drop the blank line after Subject:
    .trim();

  return { subject, body };
}

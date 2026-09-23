import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic Claude client wrapper.
 *
 * Two modes:
 *  - MOCK_CHAT=true → returns scripted replies (no API call). Lets the
 *    portal chat UI be demoed without burning credits.
 *  - MOCK_CHAT=false → real Anthropic API. ANTHROPIC_API_KEY must be set.
 *
 * Model: Claude Haiku 4.5 — fast + cheap, fits the brief portal chat use
 * case in apis-bulk.jsx ("portal chat (fast/cheap)").
 */

export const CHAT_MODEL = "claude-haiku-4-5";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatCompleteInput {
  system: string;
  messages: ChatMessage[];
}

export interface ChatCompleteResult {
  /** Plain text from the model's first text content block */
  text: string;
  /** Mock or real */
  source: "mock" | "anthropic";
}

export async function chatComplete(input: ChatCompleteInput): Promise<ChatCompleteResult> {
  // Default to mock. Real Claude call activates only when MOCK_CHAT is
  // explicitly "false" AND ANTHROPIC_API_KEY is set.
  if (process.env.MOCK_CHAT !== "false" || !process.env.ANTHROPIC_API_KEY) {
    return { text: mockReply(input.messages), source: "mock" };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 600,
    system: input.system,
    messages: input.messages,
  });

  const rawText = resp.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Defence in depth: even though every Claude system prompt forbids em
  // dashes, models sometimes slip. Strip U+2014 to a plain hyphen here
  // so it can never reach a customer email regardless of which prompt
  // generated the text. This is the single chokepoint for every
  // Claude-generated string in the app.
  const text = sanitiseClaudeOutput(rawText);

  return { text, source: "anthropic" };
}

/** Strip every Mankin-forbidden character pattern from Claude's
 *  output. Currently: em dashes (U+2014) become hyphens. Add new
 *  passes here if other characters become problematic. */
export function sanitiseClaudeOutput(text: string): string {
  return text.replace(/—/g, "-");
}

/* --------------------------------------------------------------------------
   Mock reply heuristic. Tries to match common doc questions to the answers
   in the system prompt so the demo feels real. Falls back to a "Michael's
   the right person" escalation.
-------------------------------------------------------------------------- */

function mockReply(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content.toLowerCase() ?? "";

  if (/notice of assessment|\bnoa\b/.test(lastUser)) {
    return "A Notice of Assessment is the ATO statement showing your assessed income for that tax year. You can grab the last two years from myGov → ATO → Tax history.";
  }
  if (/super(?:annuation)? statement/.test(lastUser)) {
    return "Log into your super fund's online portal and download the last 12 months of statements. myGov also has them under Super → your fund → statements.";
  }
  if (/payslip/.test(lastUser)) {
    return "We need your two most recent payslips, usually emailed by your employer's payroll system, or available in their HR portal. Within the last 6 weeks is the rule.";
  }
  if (/secure|encrypt|safe|hosted/.test(lastUser)) {
    return "Everything you upload is encrypted (AES-256) and hosted in Australia. Only Michael Mankin and his loan associate can see it.";
  }
  if (/(still need|left|outstanding|what.*docs?)/.test(lastUser)) {
    return "I'll keep this short. Check the doc rows on this page: anything still showing Pending or Overdue is what's left. Drag a file onto a row to upload.";
  }
  if (/rate|borrow|approval|lender|capacity|product/.test(lastUser)) {
    return "Michael's the right person for that. Give him a buzz on 0420 699 983 or hit 'Call Michael' below.";
  }
  if (/hello|hi|hey|g'day/.test(lastUser)) {
    return "Hi, I'm Mankin's portal assistant. I can help you find documents, explain what we need, or answer questions about security. For anything about your loan itself, I'll always point you to Michael.";
  }
  return "I can help with what each document is, where to find it, or why we need it. For anything about your loan, rates, or approval, Michael's the right person on 0420 699 983.";
}

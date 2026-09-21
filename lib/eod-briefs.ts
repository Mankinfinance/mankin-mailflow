import "server-only";
import { unstable_cache } from "next/cache";
import { chatComplete } from "@/lib/clients/claude";
import { docNameForEmail } from "@/lib/clients/salestrekker/doc-catalog";
import { stageMeta, type Deal } from "@/lib/clients/salestrekker/types";
import { repos } from "@/lib/db/repos";
import type { EodBriefRow } from "@/lib/db/schema";
import { eodUpdateSubject, dealGreetingFirstName } from "@/lib/deal-subjects";
import { getLenderSlaMap, slaStatusForDeal } from "@/lib/lender-sla";
import { slaCustomerSentence } from "@/lib/sla-comms";

/**
 * End-of-day briefs — drafted "where we're up to" emails for every
 * open customer in a broker's queue.
 *
 * Triggered either at 4pm AEST by the Vercel cron (production) or by
 * the broker hitting "Generate now" on the dashboard. Day-idempotent:
 * re-running it for the same date doesn't duplicate rows.
 *
 * Mock-friendly. With MOCK_CHAT default-true the drafts come from a
 * deterministic local heuristic so the deck can be demoed without
 * burning API credits.
 */

const SYSTEM_PROMPT = `You are a writing assistant for Mankin Finance, a small Australian mortgage brokerage in Oran Park, NSW.

Your job: write a short end-of-day "where we're up to" update from a broker to a customer. The broker reviews it and sends. It should read like a considered note from someone who actually looked at the customer's file today, not a template.

VOICE RULES (enforce strictly):
- Plain, warm Australian English. Write to one person you respect, the way you'd speak to them.
- Australian spellings (organise, finalise, recognise).
- No Americanisms. Never "reach out", "circle back", "touch base", or "loop in".
- No exclamation marks anywhere.
- NEVER use em dashes (Unicode U+2014), the long dash character. Replace with a hyphen, a full stop, a colon, a semicolon, or parentheses. Check every line of your output for this character before responding.
- Never the word "happy" in any form. Use "glad", "pleased", or "good to" instead.
- First person singular. Calm and status-focused, never pushy or salesy.
- No filler openers. Do not start with "Just a quick update", "I hope this email finds you well", or "Just touching base". Open with something real about where their loan is right now.
- No hollow reassurance. Be specific enough that the customer can tell this was written about their file, not any file.

OUTPUT FORMAT:
- Start with one line "Subject: <subject>" then a blank line, then the body. The subject is supplied verbatim by the caller as SUBJECT_OVERRIDE - do not change it.
- Body is plain text. No markdown.
- SHORT. Greeting, then two to four sentences, then a one-line sign-off with the phone number. If you can't fill three sentences with real information, use two. Length is not the goal; a customer reading it in ten seconds and knowing exactly where they stand is the goal.

CONTENT:
- Lead with the single most important fact about THIS file right now, in plain English: what stage means for them, what is being waited on, or what happens next. Not "here is where your application sits" - just say the thing.
- If something is needed from the customer (documents), that is the message: name it and say what happens once it arrives. Nothing else needed.
- If the file is with the lender or with us, say so plainly and say there is nothing for them to do. Do not pad it with reassurance.
- If the context includes "slaExpectation", use it as the timeframe. It is a SOFT expectation, never a promise; keep its "around X business days" framing. If we are past the lender's turnaround, frame it as us actively chasing.

BANNED - never write these or anything like them:
- "Just a quick update", "I hope this finds you well", "touching base".
- "We're working through it at our end", "rest assured", "in the meantime", "I'll be in touch the moment there's news" as a standalone line with no actual news.
- Any sentence that would be equally true of any customer's file. If a line doesn't contain a fact specific to this deal, delete it.`;

/* -------------------------------------------------------------------------- */
/* Brief context + prompt                                                     */
/* -------------------------------------------------------------------------- */

/** Real lender display name, or null when it's still a placeholder
 *  ("TBC", "Comparing N options", blank) that shouldn't surface in
 *  customer copy as "with Comparing 3 options". Mirrors realLender in
 *  email-templates.ts. */
function realLenderName(deal: Deal): string | null {
  const name = deal.lender
    .replace(" (chosen)", "")
    .replace(" (proposed)", "")
    .trim();
  if (!name || name.startsWith("TBC") || name.startsWith("Comparing")) {
    return null;
  }
  return name;
}

interface BriefContextInput {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
  /** Soft, customer-facing SLA line ("...currently taking around 5
   *  business days, I'd expect to hear back in the next few days"), or
   *  null when the lender has no SLA figures. */
  slaSentence?: string | null;
}

function buildBriefPrompt(input: BriefContextInput): string {
  const { deal, brokerShort, brokerPhone } = input;
  const meta = stageMeta(deal.stageId);
  // Joint-aware: "Sarah and Tom" for couples, single first name otherwise.
  const firstName = dealGreetingFirstName(deal);

  const overdueDocs = deal.overdue.map((id) => docNameForEmail(deal.customDocs, id));
  const pendingDocs = deal.pending.map((id) => docNameForEmail(deal.customDocs, id));

  const context = {
    customer: { firstName },
    // Soft SLA expectation for the AI to weave in, when we have one.
    slaExpectation: input.slaSentence ?? undefined,
    deal: {
      stage: meta.label,
      stageGoal: meta.goal,
      lender: realLenderName(deal) ?? "(not chosen yet)",
      daysSinceContact: deal.daysSinceContact,
      settlementDate: deal.settlement,
    },
    docs: {
      receivedCount: deal.received.length,
      overdue: overdueDocs,
      pending: pendingDocs,
    },
    broker: { short: brokerShort, phone: brokerPhone },
  };

  const subjectOverride = eodUpdateSubject(deal);
  return [
    "Write a brief end-of-day status update email to this customer.",
    `Start the email with "Subject: ${subjectOverride}" (copy that subject verbatim, do not change it), then a blank line, then the body.`,
    `Customer first name: ${firstName}.`,
    `Tone: warm, informative, no pressure. Reassuring update style.`,
    `Sign off as ${brokerShort}, Mankin Finance, ${brokerPhone}.`,
    "",
    "Context (JSON):",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "Output the email now:",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Deterministic mock fallback                                                 */
/* -------------------------------------------------------------------------- */

/** Join doc names into "A, B and C". */
function joinDocs(ids: string[], deal: Deal): string {
  const names = ids.map((id) => docNameForEmail(deal.customDocs, id));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Deterministic brief used when Claude isn't configured. Deliberately
 * short: one greeting, ONE line that actually says where the deal is and
 * what happens next, one sign-off. No "just a quick update", no "we're
 * working through it at our end" — every line has to carry information the
 * customer couldn't have guessed.
 */
function mockBrief(input: BriefContextInput): { subject: string; body: string } {
  const { deal, brokerShort, brokerPhone, slaSentence } = input;
  const meta = stageMeta(deal.stageId);
  const firstName = dealGreetingFirstName(deal);
  const lender = realLenderName(deal);
  const withLender = lender ? ` with ${lender}` : "";
  const subject = eodUpdateSubject(deal);

  // The single most useful thing to say, chosen by where the deal sits.
  let core: string;
  if (deal.overdue.length > 0) {
    const one = deal.overdue.length === 1;
    core = `I'm waiting on ${joinDocs(deal.overdue, deal)} before your application can move forward. Send ${one ? "it" : "them"} through whenever you can and I'll take it from there; if ${one ? "it's" : "they're"} hard to track down, tell me and we'll find another way.`;
  } else if (deal.pending.length > 0) {
    const docs = joinDocs(deal.pending.slice(0, 3), deal);
    const one = deal.pending.length === 1;
    core = `Still to come from you: ${docs}. Once ${one ? "that's" : "those are"} in I can lodge${withLender}.`;
  } else if (deal.stageId === "lodged" || deal.stageId === "cond-approved") {
    core = slaSentence
      ? `${slaSentence} Nothing needed from you while they review it.`
      : `Your file is with ${lender ?? "the lender"} for assessment. Nothing needed from you while they review it; I'll come to you the moment they come back.`;
  } else if (deal.stageId === "unconditional") {
    core = `You're unconditionally approved${withLender}. Loan documents are next, and I'll send them the moment the lender issues them.`;
  } else if (deal.stageId === "loan-docs") {
    core = `Your loan documents are the next step${withLender}. I'll walk you through signing them as soon as they land.`;
  } else if (deal.stageId === "settle-booked") {
    core = `Settlement is booked for ${deal.settlement}. I'll confirm the final numbers with you the day before.`;
  } else {
    // Nothing specific outstanding — one honest line, not a paragraph of
    // reassurance. The broker can skip sending these from the deck.
    core = `No change on your file today. It's at ${meta.label.toLowerCase()} and moving along; I'll flag the moment there's a step for you.`;
  }

  const body = [
    `Hi ${firstName},`,
    "",
    core,
    "",
    `Any questions, I'm on ${brokerPhone}.`,
    "",
    brokerShort,
    "Mankin Finance",
  ].join("\n");

  return { subject, body };
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */

/** YYYY-MM-DD in local time — used as the day-bucket key. */
export function generationDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* -------------------------------------------------------------------------- */
/* Public generation API                                                       */
/* -------------------------------------------------------------------------- */

export interface GenerateBriefsResult {
  generated: number;
  skipped: number;
  alreadyExisted: number;
}

/**
 * Generate one brief per eligible open deal for a broker. Skips:
 *   • Settled deals
 *   • Deals with excludeFromDailyUpdates = true
 *   • Deals that already have a brief for today (idempotency)
 *
 * Returns the count delta — UI can show "Generated 12 new briefs · 3 already existed".
 */
export async function generateBriefsForBroker(args: {
  brokerId: string;
  brokerShort: string;
  brokerPhone: string;
  deals: Deal[];
  source: "auto" | "manual";
  now?: Date;
}): Promise<GenerateBriefsResult> {
  const date = generationDateKey(args.now);
  const eodRepo = repos().eodBrief;
  // One SLA lookup for the whole run; each deal derives its soft
  // "when to expect news" line from its selected lender's turnaround.
  const slaMap = await getLenderSlaMap();

  // Only deals this broker owns + that are still active + not opted out.
  // Nurtured deals are silent until manually returned to active.
  const eligible = args.deals.filter(
    (d) =>
      d.brokerId === args.brokerId &&
      d.stageId !== "settled" &&
      d.nurturedAt === null &&
      !d.excludeFromDailyUpdates,
  );

  let generated = 0;
  let skipped = 0;
  let alreadyExisted = 0;

  for (const deal of eligible) {
    const existing = await eodRepo.findForDealOnDate(deal.id, date);
    if (existing) {
      alreadyExisted += 1;
      continue;
    }

    let subject: string;
    let body: string;
    let aiSource: "anthropic" | "mock" = "mock";

    const ctx: BriefContextInput = {
      deal,
      brokerShort: args.brokerShort,
      brokerPhone: args.brokerPhone,
      slaSentence: slaCustomerSentence(
        deal,
        slaStatusForDeal(deal, slaMap, args.now),
      ),
    };

    /* Default to the deterministic mock; the chatComplete client itself
       routes to Claude only when MOCK_CHAT=false + ANTHROPIC_API_KEY. */
    if (process.env.MOCK_CHAT !== "false" || !process.env.ANTHROPIC_API_KEY) {
      const drafted = mockBrief(ctx);
      subject = drafted.subject;
      body = drafted.body;
    } else {
      try {
        const completion = await chatComplete({
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: buildBriefPrompt(ctx),
            },
          ],
        });
        const parsed = parseSubjectAndBody(completion.text);
        if (parsed) {
          subject = parsed.subject;
          body = parsed.body;
          aiSource = completion.source;
        } else {
          // Parse failure — fall back to the deterministic draft.
          const fallback = mockBrief(ctx);
          subject = fallback.subject;
          body = fallback.body;
        }
      } catch (err) {
        console.error(`[eod-briefs] Claude call failed for ${deal.id}`, err);
        const fallback = mockBrief(ctx);
        subject = fallback.subject;
        body = fallback.body;
        skipped += 1;
        continue;
      }
    }

    await eodRepo.insert({
      dealId: deal.id,
      brokerId: args.brokerId,
      generationDate: date,
      subject,
      body,
      status: "queued",
      aiSource,
      source: args.source,
    });
    generated += 1;
  }

  return { generated, skipped, alreadyExisted };
}

function parseSubjectAndBody(text: string): { subject: string; body: string } | null {
  if (!text) return null;
  const lines = text.trim().split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const m = /^subject\s*:\s*(.+)$/i.exec(lines[i]);
    if (m) {
      const subject = m[1].trim();
      const body = lines
        .slice(i + 1)
        .join("\n")
        .replace(/^\s*\n+/, "")
        .trim();
      return { subject, body };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Query helper                                                                */
/* -------------------------------------------------------------------------- */

export async function queuedBriefsForBroker(brokerId: string): Promise<EodBriefRow[]> {
  return repos().eodBrief.listQueuedForBroker(brokerId, generationDateKey());
}

/**
 * Cached (~30s) queued-briefs read for the PageHeader, which renders on
 * every dashboard page and every inline-edit router.refresh(). Without
 * this it fired a Postgres query per render on the hot edit path. Briefs
 * only change at the 4pm generation run, so brief staleness is harmless;
 * the cache key includes the brokerId so each broker gets their own set.
 */
export const queuedBriefsForBrokerCached = unstable_cache(
  (brokerId: string) => repos().eodBrief.listQueuedForBroker(brokerId, generationDateKey()),
  ["queued-briefs-v1"],
  { revalidate: 30 },
);

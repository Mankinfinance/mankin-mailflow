import "server-only";
import { chatComplete } from "@/lib/clients/claude";
import { docNameForEmail } from "@/lib/clients/salestrekker/doc-catalog";
import { stageMeta, type Deal } from "@/lib/clients/salestrekker/types";
import { repos } from "@/lib/db/repos";
import type { EodBriefRow } from "@/lib/db/schema";
import { eowUpdateSubject, dealGreetingFirstName } from "@/lib/deal-subjects";

/**
 * End-of-week briefs. Sibling of lib/eod-briefs.ts: same structure,
 * different cadence + framing.
 *
 * Fires at Friday noon AEST via the Vercel cron (production) or by a
 * broker hitting "Generate weekly" from the dashboard. Idempotent on
 * the ISO week key (e.g. "2026-W22") so re-running on the same Friday
 * doesn't duplicate rows.
 *
 * Stores into the shared `eod_briefs` table - keeps the dashboard UI
 * code path single. We tag the generation_date with a "W:" prefix so
 * EOD and EOW briefs never collide on idempotency lookup.
 */

const SYSTEM_PROMPT = `You are a writing assistant for Mankin Finance, a small Australian mortgage brokerage in Oran Park, NSW.

Your job: write a brief end-of-week summary email from a broker to a customer. The broker reviews and sends.

VOICE RULES (enforce strictly):
- Plain Australian English. No Americanisms ("reach out", "circle back").
- No exclamation marks anywhere.
- NEVER use em dashes (Unicode U+2014). This includes the character that looks like a long dash. Replace with a hyphen, a full stop, a colon, a semicolon, or parentheses. Check every line of your output for this character before responding.
- Never the word "happy" in any form. Use "glad", "pleased", "good to" instead.
- Australian spellings (organise, finalise, recognise).
- First person singular. Polite, status-focused, no pressure.

OUTPUT FORMAT:
- Start with one line "Subject: <subject>" then a blank line, then the body. The subject is supplied verbatim by the caller as SUBJECT_OVERRIDE. Do not change it.
- Body is plain text. No markdown.
- Keep it short. 3-5 short paragraphs. Reassuring, summary-style.

CONTENT:
- One-sentence summary of where the deal sits at the end of the week.
- What progressed this week (movement, lender response, docs received).
- What's expected next week (next milestone with a rough day).
- Anything the customer can usefully action over the weekend.
- Sign off from the broker with their phone number.`;

interface BriefContextInput {
  deal: Deal;
  brokerShort: string;
  brokerPhone: string;
}

function buildBriefPrompt(input: BriefContextInput): string {
  const { deal, brokerShort, brokerPhone } = input;
  const meta = stageMeta(deal.stageId);
  const firstName = dealGreetingFirstName(deal);
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");

  const overdueDocs = deal.overdue.map((id) => docNameForEmail(deal.customDocs, id));
  const pendingDocs = deal.pending.map((id) => docNameForEmail(deal.customDocs, id));

  const context = {
    customer: { firstName },
    deal: {
      stage: meta.label,
      stageGoal: meta.goal,
      lender: lenderShort || "(lender TBC)",
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

  const subjectOverride = eowUpdateSubject(deal);
  return [
    "Write a brief end-of-week status summary email to this customer.",
    `Start with "Subject: ${subjectOverride}" (copy that verbatim), then a blank line, then the body.`,
    `Customer first name: ${firstName}.`,
    `Tone: warm, summary-style, no pressure. The weekly cadence is a "where we ended the week" recap.`,
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

function mockBrief(input: BriefContextInput): { subject: string; body: string } {
  const { deal, brokerShort, brokerPhone } = input;
  const meta = stageMeta(deal.stageId);
  const firstName = dealGreetingFirstName(deal);
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");
  const subject = eowUpdateSubject(deal);

  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(
    `Wrapping the week with a quick recap of where we're at on your application${
      lenderShort ? ` with ${lenderShort}` : ""
    }. You're sitting at ${meta.label}. The next milestone is ${meta.goal.toLowerCase()}.`,
  );

  if (deal.overdue.length > 0) {
    const docs = deal.overdue.map((id) => docNameForEmail(deal.customDocs, id)).join(", ");
    lines.push("");
    lines.push(
      `Heading into next week we'll need ${docs}. If you've a moment over the weekend, sending those through means we can pick up Monday morning without losing a day.`,
    );
  } else if (deal.pending.length > 0) {
    const docs = deal.pending.slice(0, 2).map((id) => docNameForEmail(deal.customDocs, id)).join(", ");
    lines.push("");
    lines.push(
      `Outstanding for next week: ${docs}. No rush, but the sooner those come through the smoother Monday looks.`,
    );
  } else if (deal.stageId === "lodged" || deal.stageId === "cond-approved") {
    lines.push("");
    lines.push(
      `Your file is with ${lenderShort || "the lender"} for assessment. I'll be on top of it Monday and update you the moment we have news.`,
    );
  } else if (deal.stageId === "settle-booked") {
    lines.push("");
    lines.push(
      `Settlement is booked for ${deal.settlement}. Everything's tracking well. I'll touch base again early next week with the final pre-settlement checklist.`,
    );
  } else {
    lines.push("");
    lines.push(
      `Nothing for you to action over the weekend. Working through it our end and I'll be back with next steps Monday.`,
    );
  }

  lines.push("");
  lines.push(`Have a good weekend. Any questions, give me a call on ${brokerPhone}.`);
  lines.push("");
  lines.push("Kind regards,");
  lines.push(brokerShort);
  lines.push("Mankin Finance");

  return { subject, body: lines.join("\n") };
}

/* -------------------------------------------------------------------------- */
/* ISO-week key                                                                */
/* -------------------------------------------------------------------------- */

/** Returns a key like "W:2026-W22" suitable for the eod_briefs.generation_date
 *  column. The "W:" prefix segregates weekly rows from daily ones. */
export function weekKey(now: Date = new Date()): string {
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = target.getUTCDay() || 7; // Sunday → 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `W:${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface GenerateBriefsResult {
  generated: number;
  skipped: number;
  alreadyExisted: number;
}

export async function generateWeeklyBriefsForBroker(args: {
  brokerId: string;
  brokerShort: string;
  brokerPhone: string;
  deals: Deal[];
  source: "auto" | "manual";
  now?: Date;
}): Promise<GenerateBriefsResult> {
  const date = weekKey(args.now);
  const eodRepo = repos().eodBrief;

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

    if (process.env.MOCK_CHAT !== "false" || !process.env.ANTHROPIC_API_KEY) {
      const drafted = mockBrief({
        deal,
        brokerShort: args.brokerShort,
        brokerPhone: args.brokerPhone,
      });
      subject = drafted.subject;
      body = drafted.body;
    } else {
      try {
        const completion = await chatComplete({
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: buildBriefPrompt({
                deal,
                brokerShort: args.brokerShort,
                brokerPhone: args.brokerPhone,
              }),
            },
          ],
        });
        const parsed = parseSubjectAndBody(completion.text);
        if (parsed) {
          subject = parsed.subject;
          body = parsed.body;
          aiSource = completion.source;
        } else {
          const fallback = mockBrief({
            deal,
            brokerShort: args.brokerShort,
            brokerPhone: args.brokerPhone,
          });
          subject = fallback.subject;
          body = fallback.body;
        }
      } catch (err) {
        console.error(`[eow-briefs] Claude call failed for ${deal.id}`, err);
        const fallback = mockBrief({
          deal,
          brokerShort: args.brokerShort,
          brokerPhone: args.brokerPhone,
        });
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

export async function queuedWeeklyBriefsForBroker(brokerId: string): Promise<EodBriefRow[]> {
  return repos().eodBrief.listQueuedForBroker(brokerId, weekKey());
}

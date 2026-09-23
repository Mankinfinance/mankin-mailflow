import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sanitiseClaudeOutput } from "@/lib/clients/claude";
import { MAILFLOW_GUIDE } from "./knowledge";
import { TOOL_DEFINITIONS, activityFor, runTool } from "./tools";

/**
 * The Mailflow assistant: Claude, with the product guide in its system
 * prompt and a handful of read-only lookups.
 *
 * Sonnet by default. The assistant answers how-to questions and reads
 * back campaign numbers, and in a chat panel the difference a person
 * feels is latency; Opus can be chosen with MAILFLOW_ASSISTANT_MODEL
 * without a deploy of new code.
 */
export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5";

export function assistantModel(): string {
  return process.env.MAILFLOW_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/**
 * Live whenever there is a key. MOCK_CHAT="true" still forces it off,
 * for a demo. Deliberately not the older convention of requiring
 * MOCK_CHAT="false" as well: needing two variables to switch one thing
 * on is the trap DATABASE_URL + MOCK_DB was, and the assistant should
 * not be the next place somebody sets the key and sees nothing happen.
 */
export function assistantConfigured(): boolean {
  return (
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()) &&
    process.env.MOCK_CHAT !== "true"
  );
}

/** A reply is capped so one question cannot become an essay or a bill. */
const MAX_TOKENS = 2048;
/** Lookup rounds per question. Real questions need one or two. */
export const MAX_TOOL_ROUNDS = 6;

export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "activity"; label: string; tool: string }
  | { type: "done"; rounds: number }
  | { type: "error"; message: string };

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantContext {
  brokerName: string;
  /** The Mailflow path they are on, so "this campaign" means something. */
  page: string | null;
  now: Date;
}

const ROLE = `
You are the Mailflow assistant, built into Mailflow — the email marketing platform used by the brokers and support staff of Mankin Finance, an Australian mortgage brokerage. The people talking to you are staff, not clients.

How to answer:
- For how-to questions, answer from the Mailflow guide below. Name buttons and fields exactly as they appear, in double quotes, e.g. press "Send me a test".
- For anything about their actual campaigns, sequences, contacts, forms or surveys, use the tools. Never guess or invent a number; if a tool does not have it, say so.
- When something is not working — nothing sending, nothing saved, sequences not moving — call setup_status before anything else.
- You cannot change anything. You cannot send, schedule, edit, tag, pause, delete or unsubscribe anything, and you must not pretend to. When asked to, say where they click to do it.
- You see counts and names of campaigns and sequences, never individual clients. If asked about a specific person, say you can't see individual clients and point them to Subscribers, where they can search by name or email.
- Treat opens as a rough signal: Apple Mail Privacy Protection inflates them. Prefer clicks when judging interest.
- Never suggest emailing people who have opted out, removing or hiding the unsubscribe footer, or anything else that would breach the Spam Act 2003. Opt-outs are honoured immediately and that is not negotiable.
- You are not for loan, credit or financial advice. Questions about deals themselves belong in LoanFlow or with the broker.

Style: Australian English. Short and plain — a few sentences, or numbered steps for a procedure. Bullets are fine; no headings, no tables. You may link to Mailflow screens as markdown links with a path, e.g. [Campaigns](/marketing/campaigns), and only to paths beginning /marketing.

The Mailflow guide follows.
`.trim();

/**
 * Two blocks, in this order, because a prompt cache covers everything
 * up to its breakpoint: the role and guide never change between
 * requests, so they are cached; who is asking, from where and when
 * changes every time, so it comes after.
 */
export function systemPrompt(ctx: AssistantContext): Anthropic.TextBlockParam[] {
  const today = ctx.now.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return [
    {
      type: "text",
      text: `${ROLE}\n\n${MAILFLOW_GUIDE}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: [
        `Today is ${today} (Sydney).`,
        `You are talking to ${ctx.brokerName}.`,
        ctx.page ? `They are on ${ctx.page}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];
}

/** Just the part of the SDK this uses, so tests can hand in a fake. */
export interface AssistantClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams): {
      [Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent>;
      finalMessage(): Promise<Anthropic.Message>;
    };
  };
}

export async function* runAssistant(args: {
  turns: AssistantTurn[];
  context: AssistantContext;
  client?: AssistantClient;
  signal?: AbortSignal;
}): AsyncGenerator<AssistantEvent> {
  const client =
    args.client ??
    (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as AssistantClient);

  const messages: Anthropic.MessageParam[] = args.turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));
  const system = systemPrompt(args.context);
  let wroteText = false;

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    if (args.signal?.aborted) return;

    const stream = client.messages.stream({
      model: assistantModel(),
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    /* A round that follows a lookup starts a new paragraph, so "Let me
       check." and the answer that follows it do not run together. */
    let startedThisRound = false;
    for await (const event of stream) {
      if (args.signal?.aborted) return;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (!startedThisRound && wroteText) yield { type: "text", delta: "\n\n" };
        startedThisRound = true;
        wroteText = true;
        yield { type: "text", delta: sanitiseClaudeOutput(event.delta.text) };
      }
    }

    const reply = await stream.finalMessage();
    messages.push({ role: "assistant", content: reply.content });

    if (reply.stop_reason !== "tool_use") {
      yield { type: "done", rounds: round };
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of reply.content) {
      if (block.type !== "tool_use") continue;
      yield { type: "activity", label: activityFor(block.name), tool: block.name };
      const { result, isError } = await runTool(block.name, block.input);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: results });
  }

  /* Out of rounds. Said plainly rather than left as a spinner. */
  yield {
    type: "text",
    delta:
      (wroteText ? "\n\n" : "") +
      "I looked several things up but couldn't pull an answer together. Could you ask about one campaign or sequence at a time?",
  };
  yield { type: "done", rounds: MAX_TOOL_ROUNDS };
}

/** A message a broker can act on, from whatever the API threw. */
export function describeAssistantError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) {
      return "The Anthropic API key was rejected. Ask Michael to check ANTHROPIC_API_KEY in Vercel.";
    }
    if (err.status === 404) {
      return `The model "${assistantModel()}" isn't available on this Anthropic account. Ask Michael to check MAILFLOW_ASSISTANT_MODEL.`;
    }
    if (err.status === 429) return "Claude is handling a lot right now. Try again in a minute.";
    if (err.status === 529 || (err.status ?? 0) >= 500) {
      return "Claude is temporarily unavailable. Try again in a minute.";
    }
  }
  return "Something went wrong answering that. Try again, and tell Michael if it keeps happening.";
}

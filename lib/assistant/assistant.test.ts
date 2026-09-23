import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/* Contact data carries real-looking addresses so the privacy test can
   look for them. */
vi.mock("@/lib/settlements-store", () => ({
  listSettlements: async () => [
    {
      id: "L-1",
      brokerName: "Michael Mankin",
      brokerId: "mm",
      clientName: "Sarah Chen",
      email: "sarah.chen@example.com",
      lender: "ANZ",
      lenderCode: "ANZ",
      loanId: "L-1",
      settlementDate: "2025-08-25",
      settlementAmount: 640000,
      currentBalance: 610000,
      upfrontCommission: 4000,
      monthlyTrail: 90,
      loanStatus: "active",
      dischargeDate: null,
      source: { onUpfront: true, onTrail: true, onClawback: false },
    },
  ],
}));
vi.mock("@/lib/clients/salestrekker", () => ({
  getSalestrekkerClient: () => ({ listDeals: async () => [] }),
}));

const { TOOLS, TOOL_DEFINITIONS, runTool } = await import("./tools");
const {
  runAssistant,
  systemPrompt,
  assistantConfigured,
  assistantModel,
  DEFAULT_ASSISTANT_MODEL,
  MAX_TOOL_ROUNDS,
} = await import("./run");
const { MAILFLOW_GUIDE } = await import("./knowledge");
const { AssistantRequestSchema, MAX_TURNS, MAX_CHARS } = await import("./request");
const { isMailflowPath, segments } = await import("@/components/mailflow/Assistant");
const { repos } = await import("@/lib/db/repos");
const { MERGE_FIELDS } = await import("@/lib/campaigns/audience");
const { AUTOMATION_TEMPLATES } = await import("@/lib/automations/types");
const { WebhookEventSchema } = await import("@/lib/webhooks/types");

const KEEP = { ...process.env };
afterEach(() => {
  process.env = { ...KEEP };
});

/* -------------------------------------------------------------------------- */
/* A fake Claude                                                              */
/* -------------------------------------------------------------------------- */

type Scripted =
  | { text: string }
  | { tool: string; input?: Record<string, unknown>; text?: string };

/** Plays back one scripted reply per call, recording what it was sent. */
function fakeClaude(script: Scripted[]) {
  const calls: Anthropic.MessageStreamParams[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        stream(params: Anthropic.MessageStreamParams) {
          // Copied: the loop keeps appending to the same array.
          calls.push(JSON.parse(JSON.stringify(params)));
          const step = script[Math.min(i++, script.length - 1)];
          const text = "text" in step && step.text ? step.text : "";
          const content: Anthropic.ContentBlock[] = [];
          if (text) content.push({ type: "text", text, citations: null } as Anthropic.TextBlock);
          if ("tool" in step) {
            content.push({
              type: "tool_use",
              id: `tu_${i}`,
              name: step.tool,
              input: step.input ?? {},
            } as Anthropic.ToolUseBlock);
          }
          const events: Anthropic.MessageStreamEvent[] = text
            ? text.match(/[\s\S]{1,8}/g)!.map(
                (chunk) =>
                  ({
                    type: "content_block_delta",
                    index: 0,
                    delta: { type: "text_delta", text: chunk },
                  }) as Anthropic.MessageStreamEvent,
              )
            : [];
          return {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
            finalMessage: async () =>
              ({
                id: "msg",
                type: "message",
                role: "assistant",
                model: params.model,
                content,
                stop_reason: "tool" in step ? "tool_use" : "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
              }) as unknown as Anthropic.Message,
          };
        },
      },
    },
  };
}

const context = {
  brokerName: "Michael Mankin",
  page: "/marketing/campaigns",
  now: new Date("2026-09-23T02:00:00Z"),
};

async function collect(gen: AsyncGenerator<{ type: string }>) {
  const out: Array<Record<string, unknown>> = [];
  for await (const e of gen) out.push(e as Record<string, unknown>);
  return out;
}

const textOf = (events: Array<Record<string, unknown>>) =>
  events.filter((e) => e.type === "text").map((e) => e.delta).join("");

/* -------------------------------------------------------------------------- */

describe("the tools", () => {
  it("can only look things up", () => {
    // A prompt is not a permission system. If a tool that acts is ever
    // added, this is where it gets noticed.
    // A whole leading verb, so "setup_status" is not read as "set".
    const ACTS = /^(send|create|update|edit|delete|remove|schedule|tag|suppress|unsuppress|set|add|publish|pause|resume|enrol|write|post|put|patch)(?:_|$)/i;
    for (const name of Object.keys(TOOLS)) {
      expect(name, name).not.toMatch(ACTS);
    }
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(Object.keys(TOOLS).sort());
  });

  it("never hand a client's email address to Claude", async () => {
    // The firm has not decided to send client personal information to a
    // model provider, so none goes. Seeded with addresses to look for.
    const campaign = await repos().campaign.create({
      name: "Rate review",
      subject: "Worth a look",
      body: "Hi",
      status: "sent",
      audience: {},
      fromBrokerId: "mm",
      createdBy: "mm",
    });
    await repos().campaign.setRecipients(campaign.id, [
      {
        campaignId: campaign.id,
        email: "sarah.chen@example.com",
        name: "Sarah Chen",
        firstName: "Sarah",
        sourceKind: "settlements",
        sourceId: "L-1",
      },
    ]);
    await repos().campaign.suppress({ email: "tom.reilly@example.com", reason: "unsubscribe" });

    const inputs: Record<string, Record<string, unknown>> = {
      get_campaign: { name_or_id: "Rate review" },
      get_automation: { name_or_id: "anything" },
    };
    for (const name of Object.keys(TOOLS)) {
      const { result } = await runTool(name, inputs[name] ?? {});
      const json = JSON.stringify(result);
      expect(json, name).not.toContain("sarah.chen@example.com");
      expect(json, name).not.toContain("tom.reilly@example.com");
      expect(json, name).not.toContain("Sarah Chen");
    }

    await repos().campaign.unsuppress("tom.reilly@example.com");
    await repos().campaign.remove(campaign.id);
  });

  it("report setup as presence, never values", async () => {
    process.env.CRON_SECRET = "a-real-secret-value";
    process.env.MS_GRAPH_CLIENT_SECRET = "another-secret";
    const { result } = await runTool("setup_status", {});
    expect(result.scheduledJobsCanRun).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain("a-real-secret-value");
    expect(json).not.toContain("another-secret");
  });

  it("say what is missing when nothing is sending", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.MS_GRAPH_TENANT_ID;
    const { result } = await runTool("setup_status", {});
    expect(result.scheduledJobsCanRun).toBe(false);
    expect(result.microsoftSendingCredentialsSet).toBe(false);
  });

  it("find a campaign by name, not just id", async () => {
    const campaign = await repos().campaign.create({
      name: "Spring rate review",
      subject: "Worth a look",
      body: "Hi",
      status: "draft",
      audience: {},
      fromBrokerId: "mm",
      createdBy: "mm",
    });
    const { result } = await runTool("get_campaign", { name_or_id: "spring rate" });
    expect(result).toMatchObject({ found: true, name: "Spring rate review" });
    await repos().campaign.remove(campaign.id);
  });

  it("turn bad input and unknown tools into results, not crashes", async () => {
    expect((await runTool("get_campaign", {})).isError).toBe(true);
    expect((await runTool("delete_everything", {})).isError).toBe(true);
  });
});

describe("runAssistant", () => {
  beforeEach(() => {
    delete process.env.MAILFLOW_ASSISTANT_MODEL;
  });

  it("streams a plain answer and finishes", async () => {
    const { client } = fakeClaude([{ text: "Press \"Send me a test\" first." }]);
    const events = await collect(runAssistant({ turns: [{ role: "user", content: "How?" }], context, client }));
    expect(textOf(events)).toBe('Press "Send me a test" first.');
    expect(events.at(-1)).toEqual({ type: "done", rounds: 1 });
  });

  it("looks something up, hands Claude the result, then answers", async () => {
    const { client, calls } = fakeClaude([
      { text: "Let me check.", tool: "list_campaigns" },
      { text: "You have no campaigns yet." },
    ]);
    const events = await collect(
      runAssistant({ turns: [{ role: "user", content: "How did my last campaign do?" }], context, client }),
    );

    expect(events).toContainEqual({ type: "activity", label: "Checking campaigns", tool: "list_campaigns" });
    // The two rounds read as two paragraphs, not one run-on sentence.
    expect(textOf(events)).toBe("Let me check.\n\nYou have no campaigns yet.");

    const second = calls[1].messages;
    const toolResult = (second.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.tool_use_id).toBe("tu_1");
    expect(JSON.parse(toolResult.content as string)).toHaveProperty("campaigns");
  });

  it("stops after a fixed number of lookups and says so", async () => {
    const { client, calls } = fakeClaude([{ tool: "setup_status" }]);
    const events = await collect(runAssistant({ turns: [{ role: "user", content: "?" }], context, client }));
    expect(calls).toHaveLength(MAX_TOOL_ROUNDS);
    expect(textOf(events)).toContain("couldn't pull an answer together");
    expect(events.at(-1)).toEqual({ type: "done", rounds: MAX_TOOL_ROUNDS });
  });

  it("offers every tool, on the configured model", async () => {
    process.env.MAILFLOW_ASSISTANT_MODEL = "claude-opus-5-5";
    const { client, calls } = fakeClaude([{ text: "Hi." }]);
    await collect(runAssistant({ turns: [{ role: "user", content: "Hi" }], context, client }));
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].tools!.map((t) => (t as Anthropic.Tool).name).sort()).toEqual(Object.keys(TOOLS).sort());
  });

  it("strips em dashes, like every other Claude output in the app", async () => {
    const { client } = fakeClaude([{ text: "Yes — press Save." }]);
    const events = await collect(runAssistant({ turns: [{ role: "user", content: "?" }], context, client }));
    expect(textOf(events)).toBe("Yes - press Save.");
  });

  it("stops when the broker stops it", async () => {
    const { client, calls } = fakeClaude([{ text: "A long answer" }]);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      runAssistant({ turns: [{ role: "user", content: "?" }], context, client, signal: controller.signal }),
    );
    expect(events).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("the system prompt", () => {
  it("caches the guide and keeps what changes after it", () => {
    const [stable, changing] = systemPrompt(context);
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).toContain(MAILFLOW_GUIDE);
    // Nothing per-request in the cached block, or the cache never hits.
    expect(stable.text).not.toContain("Michael Mankin");
    expect(changing.cache_control).toBeUndefined();
    expect(changing.text).toContain("Wednesday 23 September 2026");
    expect(changing.text).toContain("Michael Mankin");
    expect(changing.text).toContain("/marketing/campaigns");
  });
});

describe("the guide stays true to the product", () => {
  // These fail when a screen changes and the guide does not.
  it("lists exactly the merge fields that exist", () => {
    const listed = [...MAILFLOW_GUIDE.matchAll(/\{\{([a-z_]+)\}\}/g)]
      .map((m) => m[1])
      .filter((f) => f !== "firstname" && f !== "survey_link");
    expect(new Set(listed)).toEqual(new Set(MERGE_FIELDS));
  });

  it("names every automation template", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      expect(MAILFLOW_GUIDE, t.name).toContain(t.name);
    }
  });

  it("names every webhook event", () => {
    for (const e of WebhookEventSchema.options) {
      expect(MAILFLOW_GUIDE, e).toContain(e);
    }
  });
});

describe("configuration", () => {
  it("is on whenever there is a key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.MOCK_CHAT;
    expect(assistantConfigured()).toBe(true);
  });

  it("is off without a key, or when MOCK_CHAT forces it", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(assistantConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.MOCK_CHAT = "true";
    expect(assistantConfigured()).toBe(false);
  });

  it("defaults to Sonnet", () => {
    delete process.env.MAILFLOW_ASSISTANT_MODEL;
    expect(assistantModel()).toBe(DEFAULT_ASSISTANT_MODEL);
  });
});

describe("requests", () => {
  const ok = { messages: [{ role: "user", content: "Hi" }] };

  it("accept a question", () => {
    expect(AssistantRequestSchema.safeParse(ok).success).toBe(true);
  });

  it("must start and end with the broker", () => {
    expect(
      AssistantRequestSchema.safeParse({ messages: [{ role: "assistant", content: "Hi" }] }).success,
    ).toBe(false);
    expect(
      AssistantRequestSchema.safeParse({
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
      }).success,
    ).toBe(false);
  });

  it("are bounded, so one request cannot run up a bill", () => {
    const long = { messages: [{ role: "user", content: "x".repeat(MAX_CHARS + 1) }] };
    expect(AssistantRequestSchema.safeParse(long).success).toBe(false);
    const many = {
      messages: Array.from({ length: MAX_TURNS + 1 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "x",
      })),
    };
    expect(AssistantRequestSchema.safeParse(many).success).toBe(false);
    expect(
      AssistantRequestSchema.safeParse({ messages: [{ role: "user", content: "   " }] }).success,
    ).toBe(false);
  });
});

describe("links in replies", () => {
  it("are honoured only for Mailflow's own screens", () => {
    expect(isMailflowPath("/marketing")).toBe(true);
    expect(isMailflowPath("/marketing/campaigns")).toBe(true);
    expect(isMailflowPath("/marketing/settings/database")).toBe(true);
    expect(isMailflowPath("/marketing?x=1")).toBe(true);
    expect(isMailflowPath("https://evil.example.com")).toBe(false);
    expect(isMailflowPath("//evil.example.com/marketing")).toBe(false);
    expect(isMailflowPath("/marketing.evil.example.com")).toBe(false);
    expect(isMailflowPath("javascript:alert(1)")).toBe(false);
    expect(isMailflowPath("/api/admin/migrate")).toBe(false);
  });
});

describe("reading a reply into paragraphs and lists", () => {
  it("finds a list directly under its intro line", () => {
    // The shape Claude writes most, and the one first rendered wrong.
    expect(segments("To follow up:\n1. Open Campaigns\n2. Press New campaign")).toEqual([
      { kind: "p", lines: ["To follow up:"] },
      { kind: "ol", lines: ["Open Campaigns", "Press New campaign"] },
    ]);
  });

  it("keeps bullets, numbers and paragraphs apart", () => {
    expect(segments("Two things.\n\n- one\n- two\n\nDone.")).toEqual([
      { kind: "p", lines: ["Two things."] },
      { kind: "ul", lines: ["one", "two"] },
      { kind: "p", lines: ["Done."] },
    ]);
  });

  it("keeps soft line breaks inside a paragraph", () => {
    expect(segments("Line one\nLine two")).toEqual([
      { kind: "p", lines: ["Line one", "Line two"] },
    ]);
  });

  it("starts a new list after a blank line", () => {
    expect(segments("1. a\n\n1. b")).toEqual([
      { kind: "ol", lines: ["a"] },
      { kind: "ol", lines: ["b"] },
    ]);
  });

  it("copes with nothing at all", () => {
    expect(segments("")).toEqual([]);
    expect(segments("\n\n")).toEqual([]);
  });
});

describe("the address in email links", () => {
  it("is reported as a value, since it is public and the mistake is in the value", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://mankin-followup.vercel.app";
    const { result } = await runTool("setup_status", {});
    expect(result.addressInEmailLinks).toBe("https://mankin-followup.vercel.app");
  });

  it("is reported missing rather than as the localhost fallback", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { result } = await runTool("setup_status", {});
    expect(result.addressInEmailLinks).toBeNull();
  });
});

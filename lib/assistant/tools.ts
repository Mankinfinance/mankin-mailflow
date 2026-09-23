import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { repos } from "@/lib/db/repos";
import { databaseConfig } from "@/lib/db/state";
import { listSettlements } from "@/lib/settlements-store";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { buildSubscribers, countSubscribers } from "@/lib/campaigns/subscribers";
import { AutomationFlowSchema } from "@/lib/automations/types";
import { describeTriggerFor } from "@/lib/automations/lifecycle";
import { SurveyConfigSchema } from "@/lib/surveys/types";
import { summariseNps, describeNps } from "@/lib/surveys/scoring";

/**
 * What the assistant can look up.
 *
 * Two rules, both enforced by what is and is not in this file rather
 * than by asking the model nicely:
 *
 * Read-only. Nothing here sends, schedules, edits, tags, suppresses or
 * deletes. An assistant that can be talked into emailing 186 clients
 * is not one to put in front of a busy broker, and a prompt is not a
 * permission system. The test suite asserts no tool name reads as an
 * action.
 *
 * Aggregates, not people. Tools return counts, rates, names of
 * campaigns and sequences, and link URLs — never a client's email
 * address or name. Whether client personal information should go to
 * a model provider is the firm's decision under the Privacy Act, not
 * one to make quietly in a helper; a per-contact lookup can be added
 * once that call has been made.
 */

type ToolResult = Record<string, unknown>;

interface ToolSpec<I extends z.ZodTypeAny> {
  definition: Anthropic.Tool;
  input: I;
  run: (input: z.infer<I>) => Promise<ToolResult>;
  /** Shown in the panel while it runs: "Checking campaigns…". */
  activity: string;
}

function spec<I extends z.ZodTypeAny>(s: ToolSpec<I>): ToolSpec<I> {
  return s;
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Find by id, or by a case-insensitive name match — people ask by name. */
function pick<T extends { id: string; name: string }>(
  rows: T[],
  nameOrId: string,
): T | null {
  const q = nameOrId.trim().toLowerCase();
  return (
    rows.find((r) => r.id === nameOrId) ??
    rows.find((r) => r.name.toLowerCase() === q) ??
    rows.find((r) => r.name.toLowerCase().includes(q)) ??
    null
  );
}

async function campaignSummary(c: Awaited<ReturnType<ReturnType<typeof repos>["campaign"]["list"]>>[number]) {
  const s = await repos().campaign.stats(c.id);
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    status: c.status,
    scheduledFor: iso(c.scheduledFor),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    recipients: s.total,
    sent: s.sent,
    stillToSend: s.pending,
    failed: s.failed,
    skipped: s.skipped,
    opened: s.opened,
    clicked: s.clicked,
    unsubscribed: s.unsubscribed,
    openRatePct: pct(s.opened, s.sent),
    clickRatePct: pct(s.clicked, s.sent),
    unsubscribeRatePct: pct(s.unsubscribed, s.sent),
  };
}

export const TOOLS = {
  setup_status: spec({
    activity: "Checking the setup",
    definition: {
      name: "setup_status",
      description:
        "Whether Mailflow is configured to actually keep data and send email: database, scheduled jobs, Microsoft sending credentials, Salestrekker. Use this first whenever someone says nothing is sending, nothing is saved, or sequences are not moving.",
      input_schema: { type: "object", properties: {} },
    },
    input: z.object({}),
    run: async () => {
      const db = databaseConfig();
      const present = (v?: string) => Boolean(v && v.trim());
      const graph =
        present(process.env.MS_GRAPH_TENANT_ID) &&
        present(process.env.MS_GRAPH_CLIENT_ID) &&
        present(process.env.MS_GRAPH_CLIENT_SECRET);
      /* Presence only, never a value — the same line the health
         endpoint draws. */
      return {
        build: db.commit,
        environment: db.deployEnv,
        databaseKeepingData: db.persisting,
        databaseForcedToMemoryByMockDb: db.forcedMock,
        migrationFilesShipped: db.migrationFilesShipped,
        scheduledJobsCanRun: present(process.env.CRON_SECRET),
        emailSendingIsSimulated: process.env.MOCK_OUTLOOK_SEND === "true",
        microsoftSendingCredentialsSet: graph,
        salestrekkerApiKeySet: present(process.env.SALESTREKKER_API_KEY),
        salestrekkerNotesOn: process.env.SALESTREKKER_NOTES !== "false",
        signInAddressPinned: present(process.env.AUTH_URL),
      };
    },
  }),

  audience_overview: spec({
    activity: "Counting contacts",
    definition: {
      name: "audience_overview",
      description:
        "How many contacts Mailflow can reach, split by back-book and live pipeline, and how many are on the do-not-market register. Counts only.",
      input_schema: { type: "object", properties: {} },
    },
    input: z.object({}),
    run: async () => {
      const [settlements, deals, suppressions] = await Promise.all([
        listSettlements(),
        getSalestrekkerClient().listDeals(),
        repos().campaign.listSuppressions(5000),
      ]);
      const counts = countSubscribers(
        buildSubscribers({ settlements, deals, suppressions }),
      );
      const byReason: Record<string, number> = {};
      for (const s of suppressions) {
        byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
      }
      return {
        ...counts,
        settledLoansInTheBook: settlements.length,
        dealsInThePipeline: deals.length,
        doNotMarket: suppressions.length,
        doNotMarketByReason: byReason,
      };
    },
  }),

  list_campaigns: spec({
    activity: "Checking campaigns",
    definition: {
      name: "list_campaigns",
      description:
        "Every campaign with its status and results: recipients, sent, still to send, failed, opened, clicked, unsubscribed, and rates. Newest first. Optionally filter by status (draft, scheduled, sending, sent).",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["draft", "scheduled", "sending", "sent"],
          },
        },
      },
    },
    input: z.object({
      status: z.enum(["draft", "scheduled", "sending", "sent"]).optional(),
    }),
    run: async ({ status }) => {
      const all = await repos().campaign.list(
        status ? { statuses: [status] } : undefined,
      );
      const sorted = [...all].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return {
        count: sorted.length,
        campaigns: await Promise.all(sorted.slice(0, 25).map(campaignSummary)),
        truncated: sorted.length > 25,
      };
    },
  }),

  get_campaign: spec({
    activity: "Reading a campaign",
    definition: {
      name: "get_campaign",
      description:
        "One campaign in detail, by name or id: results, the A/B test if any, and which links were clicked how often.",
      input_schema: {
        type: "object",
        properties: { name_or_id: { type: "string" } },
        required: ["name_or_id"],
      },
    },
    input: z.object({ name_or_id: z.string().min(1) }),
    run: async ({ name_or_id }) => {
      const c = pick(await repos().campaign.list(), name_or_id);
      if (!c) return { found: false };
      const [summary, links] = await Promise.all([
        campaignSummary(c),
        repos().campaign.linkClicks(c.id),
      ]);
      return {
        found: true,
        ...summary,
        abTest: c.subjectB
          ? { subjectA: c.subject, subjectB: c.subjectB, testSharePct: c.abTestPercent }
          : null,
        tracksOpens: c.trackOpens,
        tracksClicks: c.trackClicks,
        links: links
          .map((l) => ({ url: l.url, clicks: l.clicks }))
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 15),
      };
    },
  }),

  list_automations: spec({
    activity: "Checking sequences",
    definition: {
      name: "list_automations",
      description:
        "Every automation (sequence): status, what triggers it, and how many people have entered, are waiting, finished or were stopped.",
      input_schema: { type: "object", properties: {} },
    },
    input: z.object({}),
    run: async () => {
      const autos = await repos().automation.list();
      return {
        count: autos.length,
        automations: await Promise.all(
          autos.map(async (a) => {
            const parsed = AutomationFlowSchema.safeParse(a.flow);
            const runs = await repos().automation.listRuns(a.id, { limit: 5000 });
            const tally = (s: string) => runs.filter((r) => r.status === s).length;
            return {
              id: a.id,
              name: a.name,
              status: a.status,
              trigger: parsed.success
                ? await describeTriggerFor(parsed.data.trigger)
                : "This sequence could not be read.",
              activatedAt: iso(a.activatedAt),
              entered: runs.length,
              waiting: tally("waiting"),
              finished: tally("done"),
              stopped: tally("exited"),
            };
          }),
        ),
      };
    },
  }),

  get_automation: spec({
    activity: "Reading a sequence",
    definition: {
      name: "get_automation",
      description:
        "One automation in detail, by name or id: every step in order and, for each send step, how many were sent, opened, clicked and dropped.",
      input_schema: {
        type: "object",
        properties: { name_or_id: { type: "string" } },
        required: ["name_or_id"],
      },
    },
    input: z.object({ name_or_id: z.string().min(1) }),
    run: async ({ name_or_id }) => {
      const a = pick(await repos().automation.list(), name_or_id);
      if (!a) return { found: false };
      const parsed = AutomationFlowSchema.safeParse(a.flow);
      if (!parsed.success) {
        return { found: true, name: a.name, readable: false };
      }
      const stats = new Map(
        (await repos().automation.nodeStats(a.id)).map((s) => [s.nodeId, s]),
      );
      return {
        found: true,
        name: a.name,
        status: a.status,
        trigger: await describeTriggerFor(parsed.data.trigger),
        steps: parsed.data.nodes.map((n) => {
          const st = stats.get(n.id);
          return {
            id: n.id,
            kind: n.kind,
            subject: n.subject ?? null,
            delayDays: n.kind === "delay" ? (n.days ?? null) : null,
            check: n.kind === "condition" ? (n.check ?? null) : null,
            withinDays: n.kind === "condition" ? (n.withinDays ?? null) : null,
            exitNote: n.kind === "exit" ? (n.note ?? null) : null,
            ...(st
              ? { sent: st.sent, opened: st.opened, clicked: st.clicked, dropped: st.dropped }
              : {}),
          };
        }),
      };
    },
  }),

  forms_and_surveys: spec({
    activity: "Checking forms and surveys",
    definition: {
      name: "forms_and_surveys",
      description:
        "Forms (status, views, submissions, conversion) and surveys (status, responses, Net Promoter score where there are enough answers).",
      input_schema: { type: "object", properties: {} },
    },
    input: z.object({}),
    run: async () => {
      const [forms, submissions, surveys, responses] = await Promise.all([
        repos().form.list(),
        repos().form.submissionCounts(),
        repos().survey.list(),
        repos().survey.responseCounts(),
      ]);
      return {
        forms: forms.map((f) => ({
          name: f.name,
          status: f.status,
          views: f.views,
          submissions: submissions[f.id] ?? 0,
          conversionPct: pct(submissions[f.id] ?? 0, f.views),
        })),
        surveys: await Promise.all(
          surveys.map(async (s) => {
            const config = SurveyConfigSchema.safeParse(s.config);
            const npsId = config.success
              ? config.data.questions.find((q) => q.kind === "nps")?.id
              : undefined;
            let nps: string | null = null;
            if (npsId) {
              const rows = await repos().survey.listResponses(s.id, 5000);
              nps = describeNps(
                summariseNps(rows.map((r) => Number(r.answers[npsId]))),
              );
            }
            return {
              name: s.name,
              status: s.status,
              sent: s.sent,
              responses: responses[s.id] ?? 0,
              netPromoter: nps,
            };
          }),
        ),
      };
    },
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = Object.values(TOOLS).map(
  (t) => t.definition,
);

export function activityFor(name: string): string {
  return (TOOLS as Record<string, { activity: string }>)[name]?.activity ?? "Looking that up";
}

/**
 * Run one tool call. Never throws: a failure becomes an error result
 * the model can read and explain, rather than a dead conversation.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
): Promise<{ result: ToolResult; isError: boolean }> {
  const tool = (TOOLS as Record<string, ToolSpec<z.ZodTypeAny>>)[name];
  if (!tool) return { result: { error: `No tool called ${name}.` }, isError: true };

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { result: { error: "Those inputs could not be read." }, isError: true };
  }
  try {
    return { result: await tool.run(parsed.data), isError: false };
  } catch (err) {
    return {
      result: { error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      isError: true,
    };
  }
}

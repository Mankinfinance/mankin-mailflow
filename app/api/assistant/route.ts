import { NextResponse } from "next/server";
import type { z } from "zod";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin, isUserDisabled } from "@/lib/auth/permissions";
import { auditLog } from "@/lib/audit";
import {
  assistantConfigured,
  assistantModel,
  describeAssistantError,
  runAssistant,
} from "@/lib/assistant/run";
import { AssistantRequestSchema } from "@/lib/assistant/request";

/**
 * The assistant's one endpoint.
 *
 * Streams newline-delimited JSON — text deltas, "looking that up"
 * activity, then done — so a reply appears as it is written instead of
 * after a silent five seconds.
 *
 * Gated exactly like the Mailflow screens: a signed-in broker who may
 * use Mailflow. The proxy already keeps strangers out of /api; this
 * repeats the check because a route that spends money on a third
 * party should not rely on a matcher being right.
 *
 * Stateless. The browser holds the conversation and sends it each
 * time, which keeps nothing a broker typed on the server, and the
 * limits below bound what one request can cost.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const broker = await currentBroker();
  if (
    (await isUserDisabled(broker.id)) ||
    !(await canAccessAdmin(broker.id))
  ) {
    return NextResponse.json({ error: "Mailflow access required." }, { status: 403 });
  }

  if (!assistantConfigured()) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't switched on yet. It needs ANTHROPIC_API_KEY set in Vercel — ask Michael.",
        setup: true,
      },
      { status: 503 },
    );
  }

  let body: z.infer<typeof AssistantRequestSchema>;
  try {
    const parsed = AssistantRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That request could not be read." },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const tools: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let ok = true;
      let rounds = 0;
      try {
        for await (const event of runAssistant({
          turns: body.messages,
          context: {
            brokerName: broker.name,
            page: body.page ?? null,
            now: new Date(),
          },
          signal: req.signal,
        })) {
          if (event.type === "activity") tools.push(event.tool);
          if (event.type === "done") rounds = event.rounds;
          send(event);
        }
      } catch (err) {
        ok = false;
        console.error("[assistant] failed", err);
        send({ type: "error", message: describeAssistantError(err) });
      } finally {
        controller.close();
        /* What was looked up and how long it took — never what was
           asked. A broker's question can name a client, and the audit
           log is not the place to keep it. */
        await auditLog({
          actor: { type: "broker", id: broker.id },
          action: "assistant.ask",
          meta: {
            ok,
            rounds,
            tools,
            model: assistantModel(),
            turns: body.messages.length,
            ms: Date.now() - startedAt,
          },
        }).catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

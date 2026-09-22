import "server-only";
import { repos } from "@/lib/db/repos";
import { checkWebhookUrl } from "./safe-url";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
} from "./signature";
import {
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  isDelivered,
  nextAttemptAt,
  shouldRetry,
} from "./retry";
import {
  WebhookEndpointConfigSchema,
  type WebhookEnvelope,
  type WebhookEvent,
} from "./types";

/**
 * Emitting an event, and getting it to whoever asked for it.
 *
 * Two halves that never run together. `emitWebhook` writes a row per
 * subscribed endpoint and returns; the cron drains the queue. That
 * separation is the whole point: an unsubscribe must be recorded in
 * milliseconds whether or not some CRM's webhook receiver is up, and
 * an HTTP call inside the unsubscribe path would make the slowest
 * receiver the speed of the thing a customer is waiting on.
 */

/** Deliveries attempted per drain. Each is a request to a third party. */
const DRAIN_BUDGET = 40;

/**
 * Queue an event for every endpoint subscribed to it.
 *
 * Never throws. A webhook is a courtesy to another system, and a
 * failure to queue one must not roll back the thing that actually
 * happened — losing an unsubscribe because a queue insert failed
 * would be a far worse outcome than a missed notification.
 */
export async function emitWebhook(
  event: WebhookEvent,
  data: Record<string, unknown>,
  occurredAt: Date = new Date(),
): Promise<void> {
  try {
    const endpoints = await repos().webhook.endpointsFor(event);
    for (const endpoint of endpoints) {
      await repos().webhook.enqueue({
        endpointId: endpoint.id,
        event,
        payload: { event, occurredAt: occurredAt.toISOString(), data },
        status: "pending",
        attempts: 0,
        /* Due immediately — the drain decides when it actually goes. */
        nextAttemptAt: occurredAt,
      });
    }
  } catch (err) {
    console.error(
      `[webhooks] could not queue ${event}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface DrainResult {
  attempted: number;
  delivered: number;
  retrying: number;
  abandoned: number;
}

/** Attempt every delivery that is due. */
export async function drainWebhooks(
  now: Date = new Date(),
): Promise<DrainResult> {
  const result: DrainResult = {
    attempted: 0,
    delivered: 0,
    retrying: 0,
    abandoned: 0,
  };

  const due = await repos().webhook.dueDeliveries(now, DRAIN_BUDGET);

  for (const delivery of due) {
    const endpoint = await repos().webhook.getEndpoint(delivery.endpointId);
    if (!endpoint) {
      /* Endpoint deleted while this sat in the queue. */
      await repos().webhook.updateDelivery(delivery.id, {
        status: "abandoned",
        nextAttemptAt: null,
        lastError: "The endpoint was removed.",
      });
      result.abandoned += 1;
      continue;
    }
    if (!endpoint.enabled) {
      await repos().webhook.updateDelivery(delivery.id, {
        status: "abandoned",
        nextAttemptAt: null,
        lastError: "The endpoint was paused.",
      });
      result.abandoned += 1;
      continue;
    }

    result.attempted += 1;
    const attempt = delivery.attempts + 1;
    const outcome = await attemptDelivery({ endpoint, delivery, attempt, now });

    if (outcome.delivered) {
      await repos().webhook.updateDelivery(delivery.id, {
        status: "delivered",
        attempts: attempt,
        nextAttemptAt: null,
        lastStatus: outcome.status,
        lastError: null,
        deliveredAt: now,
      });
      await repos().webhook.updateEndpoint(endpoint.id, {
        lastDeliveredAt: now,
        consecutiveFailures: 0,
      });
      result.delivered += 1;
      continue;
    }

    const retryAt = shouldRetry(outcome.status)
      ? nextAttemptAt(attempt, now)
      : null;

    await repos().webhook.updateDelivery(delivery.id, {
      status: retryAt ? "pending" : "abandoned",
      attempts: attempt,
      nextAttemptAt: retryAt,
      lastStatus: outcome.status,
      lastError: outcome.error,
    });
    await repos().webhook.updateEndpoint(endpoint.id, {
      lastFailedAt: now,
      consecutiveFailures: endpoint.consecutiveFailures + 1,
    });

    if (retryAt) result.retrying += 1;
    else result.abandoned += 1;
  }

  return result;
}

interface AttemptOutcome {
  delivered: boolean;
  status: number | null;
  error: string | null;
}

async function attemptDelivery(args: {
  endpoint: { id: string; config: unknown; secret: string };
  delivery: { id: string; event: string; payload: unknown };
  attempt: number;
  now: Date;
}): Promise<AttemptOutcome> {
  const config = WebhookEndpointConfigSchema.safeParse(args.endpoint.config);
  if (!config.success) {
    return { delivered: false, status: null, error: "The endpoint's settings could not be read." };
  }

  /* Re-checked immediately before the request, not only when the
     endpoint was saved. A hostname that resolved publicly last week
     may not today, and the point of the guard is where the connection
     is actually made. */
  const verdict = await checkWebhookUrl(config.data.url);
  if (!verdict.ok) {
    return { delivered: false, status: null, error: verdict.reason };
  }

  const stored = args.delivery.payload as Omit<WebhookEnvelope, "id" | "attempt">;
  const envelope: WebhookEnvelope = {
    id: args.delivery.id,
    event: stored.event,
    occurredAt: stored.occurredAt,
    attempt: args.attempt,
    data: stored.data,
  };

  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(args.now.getTime() / 1000);
  const signature = signPayload({ body, timestamp, secret: args.endpoint.secret });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(verdict.url, {
      method: "POST",
      /* Never follow a redirect. An allowed host that 302s to
         127.0.0.1 would otherwise step straight past the SSRF guard,
         which is the classic bypass for this whole class of check. */
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "Mailflow-Webhooks/1.0",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: String(timestamp),
        [EVENT_HEADER]: args.delivery.event,
        [DELIVERY_HEADER]: args.delivery.id,
      },
      body,
    });

    if (isDelivered(response.status)) {
      return { delivered: true, status: response.status, error: null };
    }
    return {
      delivered: false,
      status: response.status,
      error: await readCappedBody(response),
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `No response within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : err instanceof Error
          ? err.message
          : String(err);
    return { delivered: false, status: null, error: message.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read enough of an error response to be useful and no more.
 *
 * A receiver answering 500 with a megabyte of stack trace should not
 * be able to spend our memory, nor fill the delivery log with it.
 */
async function readCappedBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_RESPONSE_BYTES
      ? `${trimmed.slice(0, MAX_RESPONSE_BYTES)}…`
      : trimmed;
  } catch {
    return null;
  }
}

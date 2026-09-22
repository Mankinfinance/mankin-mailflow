"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { checkWebhookUrl } from "@/lib/webhooks/safe-url";
import { generateSecret } from "@/lib/webhooks/signature";
import { WebhookEventSchema } from "@/lib/webhooks/types";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to manage webhooks." };
  }
  return { ok: true, brokerId: broker.id };
}

/**
 * Add an endpoint.
 *
 * The secret comes back in the result and is never retrievable again —
 * the same bargain Azure makes with a client secret, and for the same
 * reason: one that can be re-read from a settings page leaks through
 * everyone who can open that page.
 */
export async function createEndpointAction(input: {
  name: string;
  url: string;
  events: string[];
  description: string;
}): Promise<Result<{ id: string; secret: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give it a name." };

  const events = input.events.filter(
    (e): e is string => WebhookEventSchema.safeParse(e).success,
  );
  if (events.length === 0) {
    return { ok: false, error: "Choose at least one event to send." };
  }

  /* Checked here as well as before every send. Catching a private
     address at save time is the difference between a clear error on
     the screen and a silent failure in a cron at 8pm. */
  const verdict = await checkWebhookUrl(input.url);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const secret = generateSecret();
  const endpoint = await repos().webhook.createEndpoint({
    name,
    config: {
      url: verdict.url,
      events,
      description: input.description.trim(),
    },
    secret,
    enabled: true,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "webhook.create",
    /* The URL is logged; the secret never is. */
    meta: { endpointId: endpoint.id, url: verdict.url, events },
  });
  revalidatePath("/marketing/webhooks");
  return { ok: true, id: endpoint.id, secret };
}

export async function setEndpointEnabledAction(
  id: string,
  enabled: boolean,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const endpoint = await repos().webhook.getEndpoint(id);
  if (!endpoint) return { ok: false, error: "Endpoint not found." };

  await repos().webhook.updateEndpoint(id, {
    enabled,
    /* Re-enabling clears the streak: the count that matters for "is
       this dead" is the one since it was last working. */
    ...(enabled ? { consecutiveFailures: 0 } : {}),
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: enabled ? "webhook.enable" : "webhook.pause",
    meta: { endpointId: id },
  });
  revalidatePath("/marketing/webhooks");
  return { ok: true };
}

export async function deleteEndpointAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const endpoint = await repos().webhook.getEndpoint(id);
  if (!endpoint) return { ok: false, error: "Endpoint not found." };

  await repos().webhook.removeEndpoint(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "webhook.delete",
    meta: { endpointId: id, name: endpoint.name },
  });
  revalidatePath("/marketing/webhooks");
  return { ok: true };
}

/**
 * Queue a sample delivery so a receiver can be wired up before a real
 * client does anything.
 *
 * Deliberately a real queued delivery rather than an immediate POST:
 * testing the thing that actually runs is worth more than testing a
 * parallel path that happens to look like it.
 */
export async function sendTestAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const endpoint = await repos().webhook.getEndpoint(id);
  if (!endpoint) return { ok: false, error: "Endpoint not found." };
  if (!endpoint.enabled) return { ok: false, error: "Enable it first." };

  const config = endpoint.config as { events?: string[] };
  const event = config.events?.[0] ?? "contact.unsubscribed";

  await repos().webhook.enqueue({
    endpointId: endpoint.id,
    event,
    payload: {
      event,
      occurredAt: new Date().toISOString(),
      data: { test: true, note: "A sample from Mailflow. Nothing happened." },
    },
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(),
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "webhook.test",
    meta: { endpointId: id },
  });
  revalidatePath("/marketing/webhooks");
  return { ok: true };
}

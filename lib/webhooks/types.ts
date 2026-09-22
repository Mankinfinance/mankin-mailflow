import { z } from "zod";

/**
 * Outbound webhooks: telling another system what just happened here.
 *
 * Mailchimp lists these under "automate using your tools". The useful
 * shape for a brokerage is narrow — four events, each one a fact
 * another system would want to act on, rather than a firehose of
 * everything Mailflow does.
 *
 * What is deliberately not here: an event per open. A few hundred
 * recipients produce thousands of pixel loads, most of them proxies
 * rather than people, and a receiver would drown in them to learn
 * nothing it could not read off the report.
 */

export const WebhookEventSchema = z.enum([
  /** Someone opted out. The one every other system needs. */
  "contact.unsubscribed",
  /** A hard bounce — the address is bad and should stop being used. */
  "contact.bounced",
  /** A campaign finished sending, with its totals. */
  "campaign.sent",
  /** A survey answer arrived, with the score. Worth a phone call when
   *  it is a low one, which is the point of emitting it. */
  "survey.responded",
]);

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "contact.unsubscribed": "Someone unsubscribes",
  "contact.bounced": "An address hard-bounces",
  "campaign.sent": "A campaign finishes sending",
  "survey.responded": "A survey is answered",
};

export const WEBHOOK_EVENT_BLURBS: Record<WebhookEvent, string> = {
  "contact.unsubscribed":
    "So the CRM stops mailing them too. The most important one to wire up.",
  "contact.bounced": "For keeping the address list clean at the source.",
  "campaign.sent": "Totals once a send has drained: delivered, failed, skipped.",
  "survey.responded": "Includes the score, so a detractor can raise an alert.",
};

/**
 * The envelope every delivery carries.
 *
 * `id` is stable across retries, so a receiver can make its own
 * handling idempotent — a webhook that is delivered twice is normal,
 * and a receiver that acts twice is the receiver's bug only if we gave
 * it no way to tell.
 */
export interface WebhookEnvelope<T = Record<string, unknown>> {
  id: string;
  event: WebhookEvent;
  /** ISO 8601, when the event happened rather than when it was sent. */
  occurredAt: string;
  /** Which delivery attempt this is, starting at 1. */
  attempt: number;
  data: T;
}

export const WebhookEndpointConfigSchema = z.object({
  /** HTTPS only — these payloads carry client email addresses. */
  url: z.string().url(),
  events: z.array(WebhookEventSchema).min(1),
  /** A short note so a broker remembers what it feeds. */
  description: z.string().default(""),
});

export type WebhookEndpointConfig = z.infer<typeof WebhookEndpointConfigSchema>;

/** Terminal and non-terminal delivery states. */
export const DeliveryStatusSchema = z.enum([
  "pending",
  "delivered",
  "failed",
  /** Gave up after the last retry. */
  "abandoned",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

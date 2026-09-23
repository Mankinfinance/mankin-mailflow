import { z } from "zod";

/**
 * Outbound webhooks: telling another system what just happened here.
 *
 * Mailchimp lists these under "automate using your tools". The useful
 * shape for a brokerage is narrow — each one a fact another system
 * would want to act on, rather than a firehose of everything Mailflow
 * does.
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
  /** Somebody filled in a form. This is a lead, and it is the only
   *  event here that is worth money on its own. */
  "form.submitted",
  /** A recipient clicked something for the first time in a campaign.
   *  Intent, as opposed to the open pixel's guesswork. */
  "contact.clicked",
  /** A campaign drained without a single successful send. Something is
   *  broken — credentials, the mailbox, the domain — and nothing else
   *  in the product says so out loud. */
  "campaign.failed",
  /** A trigger fired and enrolled someone: a settlement anniversary, an
   *  equity milestone, a deal stuck at a stage. The milestone is the
   *  news, whether or not the email that follows is ever opened. */
  "automation.entered",
  /** A sequence reached an end its author drew, on whichever branch.
   *  Carries the exit step's own note ("Opened, broker picks it up"),
   *  which says what this ending means in the author's words. */
  "automation.completed",
  /** Something outside the sequence stopped it: an unsubscribe, or a
   *  flow that could not run. `reason` says which. */
  "automation.exited",
  /** An NPS answer of 0–6. A subset of survey.responded, as its own
   *  event because endpoints subscribe per event: routing detractors
   *  to an alert channel should not mean receiving every answer. */
  "survey.detractor",
]);

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "contact.unsubscribed": "Someone unsubscribes",
  "contact.bounced": "An address hard-bounces",
  "campaign.sent": "A campaign finishes sending",
  "survey.responded": "A survey is answered",
  "form.submitted": "A form is submitted",
  "contact.clicked": "Someone clicks for the first time",
  "campaign.failed": "A campaign sends nothing at all",
  "automation.entered": "A trigger enrols someone",
  "automation.completed": "A sequence reaches its end",
  "automation.exited": "A sequence is stopped",
  "survey.detractor": "A survey scores 0–6",
};

export const WEBHOOK_EVENT_BLURBS: Record<WebhookEvent, string> = {
  "contact.unsubscribed":
    "So the CRM stops mailing them too. The most important one to wire up.",
  "contact.bounced": "For keeping the address list clean at the source.",
  "campaign.sent": "Totals once a send has drained: delivered, failed, skipped.",
  "survey.responded": "Includes the score, so a detractor can raise an alert.",
  "form.submitted":
    "A new enquiry, with its answers and the deal reference if one was created. The one to wire up first if you wire up any.",
  "contact.clicked":
    "Fires once per person per campaign, with the link they clicked — a client showing interest, not a report line.",
  "campaign.failed":
    "Every send failed. Worth waking someone for: it means nothing is going out.",
  "automation.entered":
    "The milestone that fired — anniversary, equity, stuck deal — with the contact and their deal. The phone call, before the email is even read.",
  "automation.completed":
    "Reached an end the sequence was built with, and which one — \"opened, broker picks it up\" or \"followed up once\". The follow-up list.",
  "automation.exited":
    "Stopped by something outside the sequence: they unsubscribed, or it could not run. Carries the reason.",
  "survey.detractor":
    "Only the unhappy answers, so an alert channel gets these and nothing else.",
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

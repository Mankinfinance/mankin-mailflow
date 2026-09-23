import "server-only";
import { repos } from "@/lib/db/repos";
import { dealIdForSource } from "./types";

/**
 * Which email a tracking link belongs to, whichever sender sent it.
 *
 * Every open pixel, click and unsubscribe link carries a signed `cid`.
 * Campaigns put their own id there. Automations put `auto:<id>` — and
 * until this file existed, every tracking route looked that up as a
 * campaign recipient, found nothing, and silently recorded nothing.
 * The consequences were not cosmetic:
 *
 *  - every "if they clicked" / "if they opened" step in every sequence
 *    answered "no" once its window closed, so a client who clicked
 *    "book a meeting" still got the "you didn't get back to us" email
 *  - automation reports showed 0% opens and clicks, forever
 *  - no automation click ever reached a webhook or a deal note
 *
 * So there is one lookup, used by all four routes, and it knows both
 * shapes. New automation links name the exact send
 * (`auto:<automationId>:<sendId>`), so a late click on the first email
 * of a sequence is credited to the first email, not whichever went out
 * most recently. Links in emails sent before that fall back to the
 * contact's latest send for the automation.
 */

const AUTOMATION_PREFIX = "auto:";

/** The `cid` an automation email's tracking links carry. */
export function automationTrackingId(
  automationId: string,
  sendId: string,
): string {
  return `${AUTOMATION_PREFIX}${automationId}:${sendId}`;
}

export type TrackingSubject =
  | { kind: "campaign"; campaignId: string }
  | { kind: "automation"; automationId: string; sendId: string | null };

export function parseTrackingId(cid: string): TrackingSubject {
  if (!cid.startsWith(AUTOMATION_PREFIX)) {
    return { kind: "campaign", campaignId: cid };
  }
  /* Ids are UUIDs, which contain no colons, so a split is exact. */
  const [automationId = "", sendId = ""] = cid
    .slice(AUTOMATION_PREFIX.length)
    .split(":");
  return { kind: "automation", automationId, sendId: sendId || null };
}

/**
 * The campaign a tracking id belongs to, or null for anything else.
 *
 * Several columns that record which campaign prompted something —
 * email_suppressions.campaign_id, campaign_link_clicks.campaign_id —
 * are uuids. An automation's tracking id (`auto:…`) is not, and
 * Postgres rejects it outright (22P02). Written straight into the
 * suppression register, that made every unsubscribe from an
 * automation email fail in production: the insert threw, the person
 * stayed on the list, and the one-click route — which must answer 200
 * — told Gmail it had worked. The in-memory repo accepts any string,
 * so no test saw it.
 *
 * So anything that writes a campaign attribution goes through here.
 */
export function campaignIdOf(subject: TrackingSubject): string | null {
  return subject.kind === "campaign" ? subject.campaignId : null;
}

export interface Engagement {
  openedAt?: Date;
  clickedAt?: Date;
  unsubscribedAt?: Date;
}

export interface TrackedMessage {
  subject: TrackingSubject;
  /** The campaign or automation name, for a human reading the event. */
  label: string | null;
  /** The recipient's display name, when known. */
  name: string | null;
  /** The pipeline deal they came from, if they have one. */
  dealId: string | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  unsubscribedAt: Date | null;
  /** Write engagement back to whichever row this email is. */
  record(patch: Engagement): Promise<void>;
}

export async function findTrackedMessage(
  cid: string,
  email: string,
): Promise<TrackedMessage | null> {
  const subject = parseTrackingId(cid);
  const em = email.toLowerCase();

  if (subject.kind === "campaign") {
    const recipient = await repos().campaign.findRecipient(
      subject.campaignId,
      em,
    );
    if (!recipient) return null;
    const campaign = await repos().campaign.get(subject.campaignId);
    return {
      subject,
      label: campaign?.name ?? null,
      name: recipient.name || null,
      dealId: dealIdForSource(recipient.sourceKind, recipient.sourceId),
      openedAt: recipient.openedAt,
      clickedAt: recipient.clickedAt,
      unsubscribedAt: recipient.unsubscribedAt,
      record: (patch) => repos().campaign.updateRecipient(recipient.id, patch),
    };
  }

  const automations = repos().automation;
  const send = subject.sendId
    ? await automations.getSend(subject.sendId)
    : await automations.findSend(subject.automationId, em);

  /* The token is signed, so cid and email are both ours. This still
     checks they agree with the row, because a send id that exists but
     belongs to someone else would otherwise credit their email with
     this person's click. */
  if (
    !send ||
    send.automationId !== subject.automationId ||
    send.email !== em
  ) {
    return null;
  }

  const [run, automation] = await Promise.all([
    automations.getRun(send.runId),
    automations.get(subject.automationId),
  ]);

  return {
    subject,
    label: automation?.name ?? null,
    name: run?.name || null,
    dealId: run ? dealIdForSource(run.sourceKind, run.sourceId) : null,
    openedAt: send.openedAt,
    clickedAt: send.clickedAt,
    unsubscribedAt: send.unsubscribedAt,
    record: (patch) => automations.updateSend(send.id, patch),
  };
}

/**
 * The fields every per-message event carries, whichever sender it
 * came from. Receivers and the Salestrekker notes read these names.
 */
export function messageFields(message: TrackedMessage): Record<string, unknown> {
  return message.subject.kind === "campaign"
    ? {
        source: "campaign",
        campaignId: message.subject.campaignId,
        campaignName: message.label,
        dealId: message.dealId,
      }
    : {
        source: "automation",
        automationId: message.subject.automationId,
        automationName: message.label,
        dealId: message.dealId,
      };
}

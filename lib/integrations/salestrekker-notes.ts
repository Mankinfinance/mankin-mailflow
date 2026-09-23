import "server-only";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { repos } from "@/lib/db/repos";
import type { WebhookEvent } from "@/lib/webhooks/types";
import type { AudienceSource } from "@/lib/campaigns/types";

/**
 * Writing campaign activity back onto the client's file.
 *
 * Salestrekker is not a generic webhook receiver — there is no URL to
 * POST an envelope at. What there is, and what Mailflow already holds,
 * is an API client with `addNote`. So the "webhook to Salestrekker" is
 * a note on the deal, which is also the thing a broker actually wants:
 * open the file, see that the client clicked "book a meeting" on
 * Tuesday, ring them.
 *
 * Deliberately not here: form.submitted. A form with a Salestrekker
 * destination already creates the deal through the same client, so
 * announcing it again would put a note on a deal that exists because
 * of the note's own subject.
 *
 * Every failure is swallowed and logged. A note is a courtesy; losing
 * an unsubscribe because a CRM was down would be a far worse trade.
 */

/**
 * The source kind that means "this contact has a deal to write on".
 *
 * Typed against AudienceSource rather than written as a bare string,
 * because the bare string was wrong: the first version of this file
 * compared against "deal", the resolver writes "deals", and no note
 * would ever have been written in production. The tests passed because
 * their fixtures carried the same wrong value. A typo here is now a
 * compile error.
 */
const DEAL_SOURCE: AudienceSource = "deals";

/** Events that earn a line on the file. The rest are noise there. */
const NOTED: WebhookEvent[] = [
  "contact.clicked",
  "contact.unsubscribed",
  "contact.bounced",
  "survey.responded",
];

export function isNotedEvent(event: WebhookEvent): boolean {
  return NOTED.includes(event);
}

/**
 * Turn an event into the sentence a broker would want to read.
 *
 * Written as something a person said happened, not as a log line:
 * these sit among notes typed by brokers, and an event that reads like
 * machine output gets skimmed past.
 */
export function noteFor(
  event: WebhookEvent,
  data: Record<string, unknown>,
): string | null {
  const campaign =
    typeof data.campaignName === "string" ? data.campaignName : null;
  const inCampaign = campaign ? ` in "${campaign}"` : "";

  switch (event) {
    case "contact.clicked": {
      const url = typeof data.url === "string" ? data.url : null;
      return url
        ? `Clicked a link${inCampaign}: ${url}`
        : `Clicked a link${inCampaign}.`;
    }
    case "contact.unsubscribed":
      /* Worth a note precisely because it is invisible otherwise — a
         broker would otherwise wonder why this client stopped
         appearing in campaign results. */
      return `Unsubscribed from marketing email${inCampaign}. Loan correspondence is unaffected.`;
    case "contact.bounced": {
      const reason = typeof data.reason === "string" ? data.reason : null;
      return `Marketing email bounced — the address on file may be wrong${
        reason ? ` (${reason})` : ""
      }. Worth confirming it next time you speak.`;
    }
    case "survey.responded": {
      /* The event carries `nps`. An earlier version of this read
         `score`, which does not exist on the payload, so every survey
         note silently lost its number. */
      const raw = data.nps ?? data.score;
      const score = typeof raw === "number" ? raw : null;
      const comment =
        typeof data.comment === "string" && data.comment.trim()
          ? ` They said: "${data.comment.trim()}"`
          : "";
      if (score === null) return `Answered a survey.${comment}`;
      return `Answered a survey — scored ${score} out of 10.${comment}`;
    }
    default:
      return null;
  }
}

/**
 * Which deal this event belongs to, if any.
 *
 * Campaign recipients carry where they came from: a deal id, or a
 * settlement. Only the first has a file to write on — a contact from
 * the settled back-book has no open deal, and inventing one to hold a
 * note would be worse than no note.
 */
async function dealIdFor(
  data: Record<string, unknown>,
): Promise<string | null> {
  const explicit = typeof data.dealId === "string" ? data.dealId : null;
  if (explicit) return explicit;

  const campaignId =
    typeof data.campaignId === "string" ? data.campaignId : null;
  const email = typeof data.email === "string" ? data.email : null;
  if (!campaignId || !email) return null;

  const recipient = await repos().campaign.findRecipient(campaignId, email);
  if (!recipient) return null;
  return recipient.sourceKind === DEAL_SOURCE ? recipient.sourceId : null;
}

export interface NoteResult {
  noted: boolean;
  reason?: "not-noted-event" | "no-deal" | "no-text" | "failed";
}

export async function noteOnSalestrekker(
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<NoteResult> {
  if (!isNotedEvent(event)) return { noted: false, reason: "not-noted-event" };

  try {
    const body = noteFor(event, data);
    if (!body) return { noted: false, reason: "no-text" };

    const dealId = await dealIdFor(data);
    if (!dealId) return { noted: false, reason: "no-deal" };

    await getSalestrekkerClient().addNote(dealId, body);
    return { noted: true };
  } catch (err) {
    console.error(
      `[salestrekker] could not note ${event}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { noted: false, reason: "failed" };
  }
}

import "server-only";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { repos } from "@/lib/db/repos";
import { formatTimestampAU } from "@/lib/format-date";
import type { WebhookEvent } from "@/lib/webhooks/types";
import { dealIdForSource } from "@/lib/campaigns/types";

/**
 * Writing campaign activity back onto the client's deal.
 *
 * Where it lands matters, and the first version of this file got it
 * wrong. It called the Salestrekker client's addNote and described the
 * result as a note on the Salestrekker file. There is no live
 * Salestrekker connection in this codebase: the "real" client throws
 * "not yet implemented", and the one in use logs the note to the
 * server console and keeps nothing. Every note was discarded.
 *
 * What does exist is the deals table both products share — the
 * pipeline LoanFlow imports from Salestrekker — and deal_notes, which
 * LoanFlow's deal drawer lists under "Notes". So the note is written
 * there, stamped the way LoanFlow stamps its own ("who · when" on the
 * first line, which the drawer shows as the header). addNote is still
 * called afterwards, as LoanFlow does, so the day a real Salestrekker
 * client exists the note reaches Salestrekker too without a change
 * here.
 *
 * Deliberately not here: form.submitted. A form that creates a deal
 * already puts the enquiry in the deal's own comments, so a note would
 * say it twice.
 *
 * Every failure is swallowed and logged. A note is a courtesy; losing
 * an unsubscribe because a note failed would be a far worse trade.
 */

/** The name on the note's header line in LoanFlow's drawer. */
export const NOTE_AUTHOR = "Mailflow";

/** Events that earn a line on the file. The rest are noise there. */
const NOTED: WebhookEvent[] = [
  "contact.clicked",
  "contact.unsubscribed",
  "contact.bounced",
  "survey.responded",
  /* The milestone itself, which is the most valuable line of the lot:
     it is on the file whether or not the email is ever opened. */
  "automation.entered",
  "automation.completed",
  /* Deliberately absent:
     - automation.exited: its reasons are an unsubscribe (already noted
       by contact.unsubscribed — a second note would say it twice) or a
       broken sequence (an operational fault, not news about the client).
     - survey.detractor: survey.responded already notes the score. */
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
  /* A campaign or a sequence — per-message events carry one or the
     other, and the note should name whichever sent the email. */
  const sender =
    typeof data.campaignName === "string"
      ? data.campaignName
      : typeof data.automationName === "string"
        ? data.automationName
        : null;
  const inCampaign = sender ? ` in "${sender}"` : "";
  const sequence =
    typeof data.automationName === "string" ? data.automationName : null;

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
    case "automation.entered": {
      /* The canvas's own description of the trigger — "a loan passes
         its 12-month settlement anniversary" — so the file and the
         automation list never describe the same rule two ways. */
      const why =
        typeof data.triggerDescription === "string" && data.triggerDescription
          ? data.triggerDescription.charAt(0).toLowerCase() +
            data.triggerDescription.slice(1)
          : null;
      const name = sequence ? `the "${sequence}" sequence` : "a sequence";
      return why ? `Started ${name}: ${why}.` : `Started ${name}.`;
    }
    case "automation.completed": {
      const name = sequence ? `the "${sequence}" sequence` : "a sequence";
      /* The exit step's canvas note is the author saying what this
         ending means — "Opened, nothing further. The broker picks it
         up from the pipeline instead." — which is precisely the thing
         a broker opening the file needs to read. */
      const outcome =
        typeof data.outcome === "string" && data.outcome.trim()
          ? data.outcome.trim()
          : null;
      return outcome
        ? `Finished ${name}. ${outcome}`
        : `Finished ${name}.`;
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
  /* Shared with the automation runner and survey links, so all three
     agree on what counts as a deal. The first version of this line
     compared against "deal"; the resolver stores "deals". */
  return dealIdForSource(recipient.sourceKind, recipient.sourceId);
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

    const stamped = `${NOTE_AUTHOR} · ${formatTimestampAU(new Date())}\n${body}`;
    await repos().dealNotes.add({
      dealId,
      body,
      stampedBody: stamped,
      templateId: null,
      createdBy: "mailflow",
    });

    /* Mirrors LoanFlow's own note path. Today this reaches no
       Salestrekker (see the file comment); it is here so that a real
       client, when one is written, gets the note too. A failure costs
       only that copy. */
    try {
      await getSalestrekkerClient().addNote(dealId, stamped);
    } catch (err) {
      console.error("[deal notes] Salestrekker copy failed", err);
    }
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

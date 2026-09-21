import "server-only";
import { getGraphAppToken } from "./graph-token";

/**
 * App-only Microsoft Graph mailbox read, used solely to find bounce
 * messages in a sending broker's inbox.
 *
 * Separate from outlook-app-only.ts (which sends) because this needs a
 * different application permission — **Mail.Read** alongside the
 * existing Mail.Send on the same Entra app registration, with admin
 * consent. Until that is granted, Graph 403s and the caller degrades to
 * "bounce reconciliation is not configured" rather than failing a cron.
 *
 * Deliberately narrow: it fetches recent messages from daemon senders
 * only, and returns just the fields the parser needs. There is no reason
 * for this app to be able to read a broker's ordinary correspondence,
 * and the filter keeps that true in practice as well as in intent.
 */

export interface MailboxMessage {
  id: string;
  from: string;
  subject: string;
  /** Body as plain text where Graph offers it, HTML otherwise. */
  body: string;
  receivedAt: Date;
}

export class OutlookReadError extends Error {
  status?: number;
  /** True when the app registration lacks Mail.Read consent. */
  needsConsent: boolean;

  constructor(message: string, opts?: { status?: number }) {
    super(message);
    this.name = "OutlookReadError";
    this.status = opts?.status;
    this.needsConsent = opts?.status === 403 || opts?.status === 401;
  }
}

interface GraphMessage {
  id?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { content?: string };
  bodyPreview?: string;
}

/**
 * Recent non-delivery reports in one mailbox.
 *
 * Filtered server-side on received date so we page through days rather
 * than the whole mailbox, then narrowed to daemon senders in code —
 * Graph's $filter cannot express "sender starts with postmaster or
 * mailer-daemon" without a $search, and $search disables $filter on the
 * same query.
 */
export async function listRecentBounceMessages(args: {
  /** Mailbox to read, e.g. the broker a campaign sent as. */
  mailbox: string;
  /** How far back to look. */
  since: Date;
  /** Cap on messages examined, so a noisy inbox can't stall the cron. */
  limit?: number;
}): Promise<MailboxMessage[]> {
  if (process.env.MOCK_OUTLOOK_SEND === "true") {
    console.log("[outlook-read mock] would scan", args.mailbox);
    return [];
  }

  let token: string;
  try {
    token = await getGraphAppToken();
  } catch (err) {
    throw new OutlookReadError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const limit = Math.min(args.limit ?? 200, 500);
  const filter = `receivedDateTime ge ${args.since.toISOString()}`;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(args.mailbox)}/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,subject,receivedDateTime,from,bodyPreview,body` +
    `&$top=${limit}&$orderby=receivedDateTime desc`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Ask for text bodies: the parser works on plain text, and an HTML
      // NDR wrapped in markup is harder to read a status code out of.
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OutlookReadError(
      `Graph /users/${args.mailbox}/messages returned ${resp.status}: ${text.slice(0, 300)}`,
      { status: resp.status },
    );
  }

  const data = (await resp.json().catch(() => ({}))) as { value?: GraphMessage[] };
  return (data.value ?? []).map((m) => ({
    id: m.id ?? "",
    from: m.from?.emailAddress?.address ?? "",
    subject: m.subject ?? "",
    body: m.body?.content ?? m.bodyPreview ?? "",
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
  }));
}

import "server-only";
import { getGraphAppToken } from "./graph-token";

/**
 * App-only Microsoft Graph send for system-initiated emails — uploads
 * from the customer portal, scheduled handover digests, EOD briefs, etc.
 *
 * Different from `outlook-send.ts` which uses the signed-in broker's
 * delegated token via auth(). Those flows are interactive; this one
 * fires on a customer-driven request when no broker session is active.
 *
 * Activation:
 *  1. Same Entra app registration as SharePoint uploads (the env vars
 *     MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET / MS_GRAPH_TENANT_ID
 *     already exist).
 *  2. Add the application permission "Mail.Send" alongside
 *     "Files.ReadWrite.All", and click Grant admin consent.
 *  3. The `from` mailbox address must exist as a real user mailbox in
 *     the tenant. We use the broker's own Mankin mailbox so replies from
 *     them stay threaded in their own Sent items.
 *
 * When MOCK_OUTLOOK_SEND === "true" we log and return a mock result;
 * otherwise the real Graph send always runs.
 */

export interface OutlookAppOnlySendInput {
  /** The mailbox to send AS. Must be a real user in the tenant the
   *  Entra app has Mail.Send permission for. Usually the assigned
   *  broker's Mankin email so replies thread to their Sent Items. */
  from: string;
  /** Recipient email — typically the same broker for self-notification
   *  about a customer-initiated event. */
  to: string;
  cc?: string;
  subject: string;
  body: string;
  bodyContentType?: "Text" | "HTML";
  /** Save to the from mailbox's Sent Items folder. Defaults to true so
   *  the broker has a record. */
  saveToSentItems?: boolean;
}

export interface OutlookAppOnlySendResult {
  ok: true;
  mode: "live" | "mock";
}

export class OutlookAppOnlySendError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = "OutlookAppOnlySendError";
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

function recipients(csv: string): Array<{ emailAddress: { address: string } }> {
  // Split on comma OR semicolon so a semicolon-joined mailto cc still parses.
  return csv
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export async function sendEmailViaOutlookAppOnly(
  input: OutlookAppOnlySendInput,
): Promise<OutlookAppOnlySendResult> {
  const mockOutlook = process.env.MOCK_OUTLOOK_SEND === "true";
  if (mockOutlook) {
    console.log("[outlook-send app-only mock] would send", {
      from: input.from,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      bodyChars: input.body.length,
    });
    return { ok: true, mode: "mock" };
  }

  if (!input.from || !input.to) {
    throw new OutlookAppOnlySendError("from and to are required");
  }

  let accessToken: string;
  try {
    accessToken = await getGraphAppToken();
  } catch (err) {
    throw new OutlookAppOnlySendError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const payload = {
    message: {
      subject: input.subject,
      body: {
        contentType: input.bodyContentType ?? "Text",
        content: input.body,
      },
      toRecipients: recipients(input.to),
      ccRecipients: input.cc ? recipients(input.cc) : [],
    },
    saveToSentItems: input.saveToSentItems ?? true,
  };

  // /users/<mailbox>/sendMail is the app-only equivalent of /me/sendMail.
  // The mailbox must exist in the tenant.
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.from)}/sendMail`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OutlookAppOnlySendError(
      `Graph /users/${input.from}/sendMail returned ${resp.status}.`,
      { status: resp.status, body: text },
    );
  }

  return { ok: true, mode: "live" };
}

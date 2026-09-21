import "server-only";
import { getGraphAppToken } from "./graph-token";

/**
 * Sending bulk mail as raw MIME through Microsoft Graph.
 *
 * Why not the ordinary sendMail JSON body: Graph refuses to set any
 * internet message header whose name does not begin with "x-", which
 * rules out `List-Unsubscribe` and `List-Unsubscribe-Post`. Since
 * February 2024 both Gmail and Yahoo require a working one-click
 * unsubscribe header on bulk mail, and mail without it is filtered.
 * Posting a base64 RFC 822 message to the same endpoint sidesteps the
 * restriction entirely and lets us set every header a bulk sender is
 * expected to set.
 *
 * It also buys the other thing that matters for placement: a genuine
 * `multipart/alternative` body with a real plain-text part. An
 * HTML-only message is one of the oldest and most reliable spam
 * signals there is.
 *
 * Everything here is deliberately hand-built rather than pulled from a
 * MIME library: the message shape is fixed and small, and a dependency
 * that silently reorders headers or re-encodes a body is a dependency
 * that can quietly cost deliverability.
 */

export interface MimeSendInput {
  /** Mailbox to send as. Must exist in the tenant. */
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative. Never omit it. */
  text: string;
  /**
   * One-click unsubscribe endpoint (https). Receives the POST that
   * Gmail and Yahoo send when someone uses the unsubscribe button in
   * the mail client's own chrome.
   */
  unsubscribeUrl: string;
  /** Mailbox that accepts unsubscribe requests, as the fallback URI. */
  unsubscribeMailto?: string;
}

export class OutlookMimeSendError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = "OutlookMimeSendError";
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

/**
 * Refuse any header value carrying a line break.
 *
 * This module hand-assembles RFC 822, so a CR or LF inside a value does
 * not escape a string — it starts a new header. An address of
 * "someone@example.com\r\nBcc: victim@example.com" would add a real Bcc
 * to a message Exchange then signs with the firm's DKIM key.
 *
 * Every value reaching a header goes through here, including the ones
 * that look structural. Addresses arrive from a form a stranger can
 * POST to, and the validation upstream depends on which fields that
 * form happens to ask for — so the guarantee has to live at the sink,
 * where it holds for every caller, present and future.
 */
function assertHeaderSafe(field: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new OutlookMimeSendError(
      `Refusing to send: ${field} contains a line break`,
    );
  }
  return value;
}

/** RFC 2047 encoding, so a subject with an em dash or an accent does
 *  not arrive mangled or trip a content filter. */
function encodeHeaderValue(value: string): string {
  // Printable ASCII only needs no encoding; anything else does. A value
  // with CR/LF fails this test and is base64-encoded, which already
  // neutralises it — but assertHeaderSafe runs first so the failure is
  // loud rather than a silently mangled header.
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Address with a display name, encoded when the name is not ASCII. */
function formatAddress(name: string, email: string): string {
  assertHeaderSafe("sender address", email);
  if (!name) return email;
  return `${encodeHeaderValue(assertHeaderSafe("sender name", name))} <${email}>`;
}

/** Body parts are base64 with hard line breaks: it survives every
 *  gateway, where quoted-printable occasionally does not. */
function base64Body(content: string): string {
  return (
    Buffer.from(content, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

/** A domain-correct Message-ID, which some filters check for. */
function messageId(fromEmail: string): string {
  const domain = fromEmail.split("@")[1] ?? "localhost";
  const random = crypto.randomUUID();
  return `<${random}@${domain}>`;
}

export function buildMimeMessage(input: MimeSendInput): string {
  const boundary = `--mankin-${crypto.randomUUID()}`;

  const unsubscribeUris = [
    `<${assertHeaderSafe("unsubscribe URL", input.unsubscribeUrl)}>`,
  ];
  if (input.unsubscribeMailto) {
    unsubscribeUris.push(
      `<mailto:${assertHeaderSafe("unsubscribe mailbox", input.unsubscribeMailto)}>`,
    );
  }

  const headers = [
    `From: ${formatAddress(input.fromName, input.fromEmail)}`,
    `To: ${assertHeaderSafe("recipient address", input.to)}`,
    `Subject: ${encodeHeaderValue(assertHeaderSafe("subject", input.subject))}`,
    `Message-ID: ${messageId(input.fromEmail)}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    // The pair Gmail and Yahoo require on bulk mail. The POST target
    // must unsubscribe without any further interaction (RFC 8058).
    `List-Unsubscribe: ${unsubscribeUris.join(", ")}`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    // Tells well-behaved autoresponders not to reply, and marks the
    // message honestly as bulk rather than personal correspondence.
    `Precedence: bulk`,
    `Auto-Submitted: auto-generated`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    ``,
    `This is a message in MIME format.`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    base64Body(input.text),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    base64Body(input.html),
    ``,
    `--${boundary}--`,
    ``,
  ];

  return [...headers, ...body].join("\r\n");
}

export interface MimeSendResult {
  ok: true;
  mode: "live" | "mock";
}

/**
 * Send it. Graph takes the whole RFC 822 message base64-encoded, with
 * the request's own Content-Type set to text/plain.
 */
export async function sendMimeViaGraph(
  input: MimeSendInput,
): Promise<MimeSendResult> {
  if (process.env.MOCK_OUTLOOK_SEND === "true") {
    console.log("[outlook-mime mock] would send", {
      from: input.fromEmail,
      to: input.to,
      subject: input.subject,
    });
    return { ok: true, mode: "mock" };
  }

  if (!input.fromEmail || !input.to) {
    throw new OutlookMimeSendError("fromEmail and to are required");
  }

  let token: string;
  try {
    token = await getGraphAppToken();
  } catch (err) {
    throw new OutlookMimeSendError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const mime = buildMimeMessage(input);
  const encoded = Buffer.from(mime, "utf8").toString("base64");

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    input.fromEmail,
  )}/sendMail`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: encoded,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OutlookMimeSendError(
      `Graph MIME sendMail returned ${resp.status}.`,
      { status: resp.status, body: text },
    );
  }

  return { ok: true, mode: "live" };
}

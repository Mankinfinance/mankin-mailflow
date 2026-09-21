import "server-only";
import { auth } from "@/auth";
import { withSupportCc, mailtoRecipients } from "@/lib/support-cc";

/**
 * Live Microsoft Outlook send via Graph /me/sendMail using the signed-in
 * broker's delegated tokens. Emails leave from the broker's actual
 * Mankin mailbox so the From header reads correctly to customers and the
 * Sent Items folder reflects the send for compliance / audit.
 *
 * Token lifecycle:
 *  - Auth.js persists msAccessToken (~1h) + msRefreshToken (~90d) in the
 *    JWT session via the callbacks in auth.config.ts.
 *  - On each send, we check expiry; if within 60s of expiring, we use
 *    the refresh token to mint a fresh access token via the Microsoft
 *    OAuth token endpoint.
 *  - Refreshed tokens are NOT written back to the JWT here (Auth.js
 *    doesn't allow that mid-action). If the access token has lapsed
 *    while the user is mid-session, they sign in again next time the
 *    cookie rotates. For active sessions the token is refreshed
 *    per-call.
 *
 * Errors and fallbacks:
 *  - If MOCK_OUTLOOK_SEND === "true" or SKIP_AUTH !== "false", returns
 *    a mock success so local dev keeps flowing without an Entra tenant.
 *  - If the broker hasn't signed in with the Mail.ReadWrite + Mail.Send
 *    scopes (or hasn't re-consented since they were last expanded),
 *    Graph 401s and the caller surfaces "sign in again" through the
 *    existing AccessTokenInfo error path.
 */

export interface OutlookSendInput {
  to: string;
  /** Comma-separated cc list, or empty string. */
  cc?: string;
  subject: string;
  body: string;
  /** Optional override of the default content type. */
  bodyContentType?: "Text" | "HTML";
  /** If set, save the email to the broker's Sent Items folder. Defaults
   *  to true so the broker's Outlook sent items reflects what went out. */
  saveToSentItems?: boolean;
  /** Optional pre-fetched access token. When provided, this function
   *  skips the session lookup entirely — useful from server actions
   *  that have already resolved the token via getMicrosoftAccessTokenInfo
   *  so error handling lives inside the caller's try/catch instead of
   *  bubbling into Next.js's Server Components render sanitiser. */
  accessToken?: string;
  /** Bypass the EMAIL_AUTOSEND gate. Use ONLY for the /dashboard/setup
   *  test send button which the admin uses to verify Graph wiring. */
  force?: boolean;
}

export interface OutlookSendResult {
  ok: true;
  /** Microsoft message id when available — sendMail returns 202 with
   *  no body so this is empty unless we follow up with a query. */
  messageId?: string;
  mode: "live" | "mock" | "draft";
  /** When mode === "draft", the Outlook Web URL to the draft message
   *  Graph just created in the broker's mailbox. The client opens it in
   *  a new tab so the broker can review the rich HTML (bold, headers,
   *  signature) and click Send. */
  draftUrl?: string;
}

export class OutlookSendError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = "OutlookSendError";
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

/**
 * Resolve the broker's Microsoft access token without throwing. Returns
 * a discriminated result so callers (especially server actions) can
 * handle the various failure modes without their errors getting
 * sanitised by Next.js's production server-action wrapper.
 *
 * The classifications match what the /dashboard/setup page surfaces as
 * remediation hints to the broker.
 */
export type AccessTokenInfo =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      reason:
        | "no-session"
        | "no-token"
        | "expired-no-refresh"
        | "refresh-failed"
        | "missing-env"
        | "auth-error";
      message: string;
      status?: number;
    };

/**
 * Default refresh scope. Mail-only, because every broker has consented to
 * these since first sign-in. A refresh_token grant can only ask for scopes
 * the user already consented to — requesting an un-consented scope (e.g.
 * Calendars.ReadWrite before re-consent) makes Azure reject the whole
 * refresh with AADSTS65001, which would take the mail send path down with
 * it. The calendar client passes a wider scope explicitly (see
 * outlook-calendar.ts) and degrades to a "reconnect" prompt on its own.
 */
export const MAIL_REFRESH_SCOPE =
  "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access";

export async function getMicrosoftAccessTokenInfo(
  refreshScope: string = MAIL_REFRESH_SCOPE,
): Promise<AccessTokenInfo> {
  // auth() has multiple overloads in NextAuth v5 — the implicit type
  // includes a NextMiddleware shape we don't want. Use a permissive
  // local type for the awaited session.
  type MaybeSession = Awaited<ReturnType<typeof auth>> & {
    user?: { email?: string | null };
    msAccessToken?: string | null;
    msRefreshToken?: string | null;
    msAccessTokenExpiresAt?: number | null;
  };
  let session: MaybeSession | null;
  try {
    session = (await auth()) as MaybeSession | null;
  } catch (err) {
    return {
      ok: false,
      reason: "auth-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!session) {
    return {
      ok: false,
      reason: "no-session",
      message:
        "No Microsoft session is active. Sign in with your Mankin Microsoft account.",
    };
  }

  if (!session.msAccessToken) {
    return {
      ok: false,
      reason: "no-token",
      message:
        "Your current session does not carry a Microsoft access token. Sign out and back in so the JWT picks up the Mail.Send + offline_access scopes.",
    };
  }

  const expiresAt = session.msAccessTokenExpiresAt ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresAt > nowSec + 60) {
    return { ok: true, accessToken: session.msAccessToken };
  }

  // Token expired or about to. Try a refresh.
  const refreshToken = session.msRefreshToken;
  if (!refreshToken) {
    return {
      ok: false,
      reason: "expired-no-refresh",
      message:
        "Microsoft access token expired and no refresh token is available. Sign in again.",
    };
  }

  const tenantId = process.env.MS_GRAPH_TENANT_ID || "common";
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: "missing-env",
      message:
        "AUTH_MICROSOFT_ENTRA_ID_ID / AUTH_MICROSOFT_ENTRA_ID_SECRET not configured in Vercel.",
    };
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: refreshScope,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "refresh-failed",
      message: `Network error refreshing Microsoft token: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return {
      ok: false,
      reason: "refresh-failed",
      message: `Microsoft token refresh returned ${resp.status}: ${text.slice(0, 300)}`,
      status: resp.status,
    };
  }
  const data = (await resp.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!data.access_token) {
    return {
      ok: false,
      reason: "refresh-failed",
      message:
        "Microsoft token refresh succeeded but the response contained no access_token.",
    };
  }
  return { ok: true, accessToken: data.access_token };
}

/**
 * Parse a list of email addresses into the Graph `EmailAddress` recipient
 * shape. Splits on comma OR semicolon so it works whether the caller
 * joined with the Graph/RFC comma or the Outlook-mailto semicolon. Trims
 * whitespace and skips empty tokens.
 */
function recipients(csv: string): Array<{ emailAddress: { address: string } }> {
  return csv
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

/**
 * Build a mailto: URL the client can open in Outlook compose. Used
 * when the EMAIL_AUTOSEND gate is off and we want the broker to review
 * + send manually rather than firing via Graph.
 *
 * Note: mailto: URLs strip HTML body content. We pass the body as
 * plain text. The HTML signature won't render in the compose window;
 * Outlook auto-appends the broker's local signature instead, which is
 * the whole point of switching to mailto.
 */
/**
 * Create a real Outlook draft in the broker's mailbox via Graph
 * POST /me/messages. The draft carries the full HTML body (bold,
 * headers, bullets, signature) and shows up in their Drafts folder. We
 * return the draft's webLink so the client can open it in Outlook on
 * the Web — from there the broker hits Send.
 *
 * Requires the Mail.ReadWrite delegated scope. Mail.Send is still
 * carried on the same token for the autosend path. If the broker hasn't
 * re-consented since this scope was added, Graph 401s and the caller
 * surfaces "sign in again" through the existing error path.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- draft-send flow, wired on demand
async function createOutlookDraft(
  input: OutlookSendInput,
  accessToken: string,
): Promise<{ draftUrl: string; messageId: string }> {
  const payload = {
    subject: input.subject,
    body: {
      contentType: input.bodyContentType ?? "Text",
      content: input.body,
    },
    toRecipients: recipients(input.to),
    ccRecipients: input.cc ? recipients(input.cc) : [],
  };

  const resp = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OutlookSendError(
      `Graph /me/messages (create draft) returned ${resp.status}.`,
      { status: resp.status, body: text },
    );
  }

  const data = (await resp.json().catch(() => ({}))) as {
    id?: string;
    webLink?: string;
  };
  if (!data.id || !data.webLink) {
    throw new OutlookSendError(
      "Graph created the draft but returned no id or webLink.",
    );
  }
  return { draftUrl: data.webLink, messageId: data.id };
}

export async function sendEmailViaOutlook(
  input: OutlookSendInput,
): Promise<OutlookSendResult> {
  // Always CC the shared support mailbox so every customer email the team
  // sends is captured centrally. De-duped and skipped when support is
  // already the recipient / already CC'd. Applies to all downstream paths
  // (mock, mailto draft, Graph autosend).
  input = { ...input, cc: withSupportCc(input.cc, input.to) };

  // Local dev / no-Entra fallback so workflows keep working without a
  // real Microsoft tenant. Mirrors the existing MOCK_* patterns.
  const skipAuth = process.env.SKIP_AUTH !== "false";
  const mockOutlook = process.env.MOCK_OUTLOOK_SEND === "true";
  if (skipAuth || mockOutlook) {
    console.log("[outlook-send mock] would send", {
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      bodyChars: input.body.length,
    });
    return { ok: true, mode: "mock" };
  }

  // Resolve the broker's access token. Same logic regardless of whether
  // we end up at the autosend path or the draft path - both need it.
  // Prefer the caller-supplied token (server actions resolve it up-front
  // so any auth() error stays inside their try/catch).
  let accessToken = input.accessToken;
  if (!accessToken) {
    const tokenInfo = await getMicrosoftAccessTokenInfo();
    if (!tokenInfo.ok) {
      throw new OutlookSendError(tokenInfo.message, {
        status: tokenInfo.status,
      });
    }
    accessToken = tokenInfo.accessToken;
  }

  /* Draft gate: when EMAIL_AUTOSEND is anything other than "true"
     (default) we build a mailto: URL so the broker's OS default mail
     client — Outlook desktop — opens a compose window with everything
     pre-filled. The broker reviews and clicks Send themselves.
     Test send button on /dashboard/setup passes force:true to bypass
     this gate and verify the live Graph send path. */
  const autosend = process.env.EMAIL_AUTOSEND === "true";
  if (!autosend && !input.force) {
    const plainBody = input.body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      // Turn HTML list items back into "• " bullets before stripping tags,
      // otherwise the document list lands in the Outlook compose window as
      // bullet-less indented lines. Close each item + the list with a break.
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#39;/g, "'")
      .trim();
    const qs = new URLSearchParams({ subject: input.subject, body: plainBody });
    // Outlook desktop splits recipients on ";" not ",", so a comma-joined
    // cc lands as one broken recipient. Format both fields with semicolons.
    if (input.cc) qs.set("cc", mailtoRecipients(input.cc));
    const draftUrl = `mailto:${mailtoRecipients(input.to)}?${qs
      .toString()
      .replace(/\+/g, "%20")}`;
    return { ok: true, mode: "draft", draftUrl };
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

  const resp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OutlookSendError(`Graph /me/sendMail returned ${resp.status}.`, {
      status: resp.status,
      body: text,
    });
  }

  // sendMail returns 202 Accepted with no body. There's no message id
  // available without polling Sent Items, which we skip to keep the
  // composer snappy.
  return { ok: true, mode: "live" };
}

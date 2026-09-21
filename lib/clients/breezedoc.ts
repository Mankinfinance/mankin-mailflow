import "server-only";
import type { Deal } from "./salestrekker/types";

/**
 * BreezeDoc e-signature client. Drives in-portal signing of the YBR
 * privacy form: the deal's applicants + guarantors become BreezeDoc
 * recipients (one "party" each, mapped to the [sig|...|signerN|...] tags
 * in the template), the document is created from a template and sent, the
 * primary applicant signs in the portal, co-signers are emailed, and on
 * completion we file the signed PDF.
 *
 * API (from breezedoc.com/developer/docs — OAuth2 bearer token):
 *   POST /api/templates/{template}/documents   create doc from a template
 *   POST /api/documents/{document}/send         send to recipients
 *   GET  /api/documents/{document}              status (recipient.completed_at)
 * The tag "signerN" binds to recipient.party N.
 *
 * Gating: mock unless MOCK_BREEZEDOC === "false" AND a token is set — so
 * production stays inert (the portal keeps the self-certify tickbox) until
 * the token + template id are configured. Mirrors the other MOCK_* gates.
 */

const BASE = "https://breezedoc.com/api";

export interface BreezeRecipientInput {
  name: string;
  email: string;
  /** 0-based signer index; binds to the template's signerN tags. */
  party: number;
}

export interface BreezeRecipient extends BreezeRecipientInput {
  id: number;
  slug: string;
  owner: boolean;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
}

export interface BreezeDocument {
  id: number;
  slug: string;
  title: string;
  completed_at: string | null;
  redirect_url: string | null;
  recipients: BreezeRecipient[];
}

export type BreezeResult<T> =
  | { ok: true; data: T; mode: "live" | "mock" }
  | { ok: false; reason: string; message: string };

function token(): string | null {
  return process.env.BREEZEDOC_API_TOKEN?.trim() || null;
}

/**
 * The BreezeDoc template id for a given signer count. One template per
 * count (1..6) keeps a solo applicant from seeing blank signature blocks.
 * Falls back to a single BREEZEDOC_TEMPLATE_ID if per-count ids aren't set.
 */
function templateIdFor(signerCount: number): string | null {
  return (
    process.env[`BREEZEDOC_TEMPLATE_ID_${signerCount}`]?.trim() ||
    process.env.BREEZEDOC_TEMPLATE_ID?.trim() ||
    null
  );
}

function anyTemplateConfigured(): boolean {
  if (process.env.BREEZEDOC_TEMPLATE_ID?.trim()) return true;
  for (let n = 1; n <= 6; n++) {
    if (process.env[`BREEZEDOC_TEMPLATE_ID_${n}`]?.trim()) return true;
  }
  return false;
}

/** True while we should NOT hit the real API (default). Real only when the
 *  flag is explicitly off AND a token + at least one template id are set. */
export function breezeMock(): boolean {
  return (
    process.env.MOCK_BREEZEDOC !== "false" ||
    !token() ||
    !anyTemplateConfigured()
  );
}

/** Whether in-portal e-sign is live (drives the portal UI swap). */
export function breezeEnabled(): boolean {
  return !breezeMock();
}

async function api<T>(
  path: string,
  init: RequestInit,
): Promise<BreezeResult<T>> {
  const t = token();
  if (!t) {
    return { ok: false, reason: "no-token", message: "BREEZEDOC_API_TOKEN not set." };
  }
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: `Network error reaching BreezeDoc: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  const text = await resp.text().catch(() => "");
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!resp.ok) {
    return {
      ok: false,
      reason: `http-${resp.status}`,
      message: `BreezeDoc ${path} returned ${resp.status}: ${text.slice(0, 300)}`,
    };
  }
  return { ok: true, data: json as T, mode: "live" };
}

/**
 * Map a deal's people to BreezeDoc recipients: applicants first, then
 * guarantors, numbered party 0..N to match the template's signer tags.
 * Skips anyone without a name. The primary applicant (party 0) is the
 * portal signer; the rest are emailed by BreezeDoc.
 */
export function dealToRecipients(deal: Deal): BreezeRecipientInput[] {
  const people: Array<{ name: string; email: string }> = [
    ...deal.applicants.map((a, i) => ({
      name: a.name.trim(),
      // applicant[0] mirrors the deal-level email
      email: (i === 0 ? deal.email || a.email : a.email).trim(),
    })),
    ...deal.guarantors.map((g) => ({ name: g.name.trim(), email: g.email.trim() })),
  ].filter((p) => p.name.length > 0);
  return people.map((p, i) => ({ name: p.name, email: p.email, party: i }));
}

/**
 * Create the privacy document from the configured template with the
 * deal's recipients, then send it. Returns the document (each recipient
 * carries a slug used to build their signing link).
 */
export async function createPrivacySigning(args: {
  deal: Deal;
  title: string;
  redirectUrl: string;
}): Promise<BreezeResult<BreezeDocument>> {
  const recipients = dealToRecipients(args.deal);

  if (breezeMock()) {
    return {
      ok: true,
      mode: "mock",
      data: {
        id: 999001,
        slug: "mock-doc",
        title: args.title,
        completed_at: null,
        redirect_url: args.redirectUrl,
        recipients: recipients.map((r, i) => ({
          ...r,
          id: 900000 + i,
          slug: `mock-recipient-${i}`,
          owner: i === 0,
          sent_at: new Date().toISOString(),
          opened_at: null,
          completed_at: null,
        })),
      },
    };
  }

  const templateId = templateIdFor(recipients.length);
  if (!templateId) {
    return {
      ok: false,
      reason: "no-template",
      message: `No BreezeDoc template configured for ${recipients.length} signer(s) (set BREEZEDOC_TEMPLATE_ID_${recipients.length}).`,
    };
  }
  const created = await api<BreezeDocument>(
    `/templates/${encodeURIComponent(templateId)}/documents`,
    {
      method: "POST",
      body: JSON.stringify({
        title: args.title,
        recipients,
        redirect_url: args.redirectUrl,
        external_id: args.deal.id,
      }),
    },
  );
  if (!created.ok) return created;

  const sent = await api<BreezeDocument>(`/documents/${created.data.id}/send`, {
    method: "POST",
    body: JSON.stringify({
      recipients: recipients.map((r) => ({ name: r.name, email: r.email })),
    }),
  });
  // Prefer the send response (recipients carry signing slugs); fall back to
  // the create response if send returns a thinner body.
  return sent.ok ? sent : created;
}

/** Fetch a document's current signing status. */
export async function getPrivacyDocument(
  documentId: number,
): Promise<BreezeResult<BreezeDocument>> {
  if (breezeMock()) {
    return {
      ok: true,
      mode: "mock",
      data: {
        id: documentId,
        slug: "mock-doc",
        title: "Privacy form",
        completed_at: null,
        redirect_url: null,
        recipients: [],
      },
    };
  }
  return api<BreezeDocument>(`/documents/${documentId}`, { method: "GET" });
}

/**
 * The signing URL a recipient opens to sign. BreezeDoc routes signing by
 * the recipient slug. TODO: confirm the exact public signing path against
 * a live document (the API returns the slug; the hosted path is likely
 * https://breezedoc.com/sign/{slug} or /d/{slug}).
 */
export function recipientSigningUrl(recipient: BreezeRecipient): string {
  return `https://breezedoc.com/sign/${recipient.slug}`;
}

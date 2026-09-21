import { composeHtmlEmail, composePlainEmail } from "@/lib/email-signature";

/**
 * Turn a campaign's written body into the exact email one recipient
 * receives: merge fields filled in, links made clickable (and optionally
 * wrapped for click tracking), the broker's signature appended, and the
 * unsubscribe footer that makes the send lawful.
 *
 * Pure module — every URL it needs is passed in, so the tests can render
 * a full email without signing a token or touching the database.
 *
 * The body uses the same light markup as the rest of LoanFlow's emails
 * (see lib/email-signature.ts: **bold**, "Heading:" lines, - bullets),
 * plus one addition campaigns need and one-to-one emails don't:
 * [label](url) links, for the call to action.
 */

/** {{field_name}} — letters, digits and underscores only. */
const MERGE_TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** [label](https://example.com) */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Replace every {{field}} with its value. Unknown fields collapse to an
 * empty string rather than leaving the raw token in a customer's inbox —
 * the editor warns about them before the broker ever hits send (see
 * unknownMergeFields), so reaching here with one is already a mistake we
 * should fail quietly on.
 */
export function applyMergeFields(
  template: string,
  fields: Record<string, string>,
): string {
  return template.replace(MERGE_TOKEN, (_match, name: string) => {
    const value = fields[name.toLowerCase()];
    return value ?? "";
  });
}

/**
 * Merge fields used in the text that aren't in the supplied set. Drives
 * the editor's "this field doesn't exist" warning, so a typo like
 * {{firstname}} is caught while the campaign is still a draft.
 */
export function unknownMergeFields(
  template: string,
  known: readonly string[],
): string[] {
  const knownSet = new Set(known.map((k) => k.toLowerCase()));
  const missing = new Set<string>();
  for (const match of template.matchAll(MERGE_TOKEN)) {
    const name = match[1].toLowerCase();
    if (!knownSet.has(name)) missing.add(name);
  }
  return [...missing];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINK_STYLE =
  "color:#1c2566;text-decoration:underline;font-weight:bold;";
const FOOTER_STYLE =
  "font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.5;color:#8a90a2;max-width:640px;margin-top:18px;padding-top:12px;border-top:1px solid #d6d8e0;";

/**
 * Pull [label](url) links out of the body, leaving a placeholder the
 * HTML renderer will carry through untouched.
 *
 * Why a placeholder: bodyToHtml escapes everything it renders, which is
 * the right default for a broker-written body — but it means an anchor
 * built before that step would arrive as visible &lt;a&gt; text. The
 * placeholder is bare alphanumerics and @, so escaping leaves it alone
 * and we can swap in the real anchor afterwards.
 */
function extractLinks(body: string): {
  masked: string;
  links: Array<{ label: string; url: string }>;
} {
  const links: Array<{ label: string; url: string }> = [];
  const masked = body.replace(MARKDOWN_LINK, (_match, label: string, url: string) => {
    const index = links.length;
    links.push({ label, url });
    return `@@MFLINK${index}@@`;
  });
  return { masked, links };
}

function restoreLinksHtml(
  html: string,
  links: Array<{ label: string; url: string }>,
  wrapUrl: (url: string) => string,
): string {
  return html.replace(/@@MFLINK(\d+)@@/g, (match, raw: string) => {
    const link = links[Number(raw)];
    if (!link) return match;
    const href = escapeHtml(wrapUrl(link.url));
    return `<a href="${href}" style="${LINK_STYLE}">${escapeHtml(link.label)}</a>`;
  });
}

function restoreLinksText(
  text: string,
  links: Array<{ label: string; url: string }>,
): string {
  return text.replace(/@@MFLINK(\d+)@@/g, (match, raw: string) => {
    const link = links[Number(raw)];
    if (!link) return match;
    // Plain-text readers need the address itself, not the label alone.
    return `${link.label}: ${link.url}`;
  });
}

/**
 * The consent line every campaign carries. Under the Spam Act 2003 a
 * commercial electronic message must identify the sender and offer a
 * working unsubscribe, so this is appended by the renderer rather than
 * left to whoever writes the body.
 *
 * The postal address is passed in rather than read from the
 * environment: it is a setting a broker edits on the settings screen,
 * and this module has to stay pure so a test can render a full email
 * without a process. Empty omits the line rather than printing a
 * guess — the Spam Act wants the sender reachable, and an address
 * nobody can write to is not that.
 */
export function unsubscribeFooterHtml(
  unsubscribeUrl: string,
  postalAddress = "",
): string {
  const href = escapeHtml(unsubscribeUrl);
  const postal = postalAddress.trim();
  return [
    `<div style="${FOOTER_STYLE}">`,
    `  You are receiving this because Mankin Finance has arranged or discussed finance for you.`,
    `  <a href="${href}" style="color:#8a90a2;text-decoration:underline;">Unsubscribe</a>`,
    `  to stop receiving updates like this. Loan-specific correspondence about an application in progress will still reach you.`,
    ...(postal ? [`  <br>Mankin Finance Pty Ltd, ${escapeHtml(postal)}`] : []),
    `</div>`,
  ].join("\n");
}

export function unsubscribeFooterText(
  unsubscribeUrl: string,
  postalAddress = "",
): string {
  const postal = postalAddress.trim();
  return [
    "—",
    "You are receiving this because Mankin Finance has arranged or discussed finance for you.",
    `To stop receiving updates like this, unsubscribe here: ${unsubscribeUrl}`,
    "Loan-specific correspondence about an application in progress will still reach you.",
    ...(postal ? [`Mankin Finance Pty Ltd, ${postal}`] : []),
  ].join("\n");
}

export interface CampaignLinks {
  /** Per-recipient unsubscribe URL. Required — there is no send without one. */
  unsubscribeUrl: string;
  /** 1x1 open-tracking pixel. Omitted when the campaign has opens off. */
  openPixelUrl?: string;
  /** Rewrites a body link for click tracking. Defaults to identity when
   *  the campaign has click tracking off. */
  wrapUrl?: (url: string) => string;
}

export interface RenderCampaignInput {
  subject: string;
  body: string;
  fields: Record<string, string>;
  /** Whose signature goes at the bottom. */
  brokerId: string;
  links: CampaignLinks;
  /** Postal address for the footer. Empty omits the line. */
  postalAddress?: string;
}

export interface RenderedCampaign {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render one recipient's copy. Merge fields are applied to the subject
 * and body first so a {{booking_url}} inside a link target resolves
 * before the link is extracted.
 */
export function renderCampaign(input: RenderCampaignInput): RenderedCampaign {
  const subject = applyMergeFields(input.subject, input.fields).trim();
  const mergedBody = applyMergeFields(input.body, input.fields);
  const { masked, links } = extractLinks(mergedBody);
  const wrapUrl = input.links.wrapUrl ?? ((url: string) => url);

  const bodyHtml = composeHtmlEmail({
    body: masked,
    brokerId: input.brokerId,
    // Campaigns go out unattended from the cron, so there is no broker
    // sitting in Outlook to insert their own signature.
    appendAppSignature: true,
  });

  const parts = [
    restoreLinksHtml(bodyHtml, links, wrapUrl),
    unsubscribeFooterHtml(input.links.unsubscribeUrl, input.postalAddress),
  ];
  if (input.links.openPixelUrl) {
    parts.push(
      `<img src="${escapeHtml(input.links.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">`,
    );
  }

  const bodyText = composePlainEmail({
    body: masked,
    brokerId: input.brokerId,
    appendAppSignature: true,
  });

  return {
    subject,
    html: parts.join("\n"),
    text: [
      restoreLinksText(bodyText, links),
      "",
      unsubscribeFooterText(input.links.unsubscribeUrl, input.postalAddress),
    ].join("\n"),
  };
}

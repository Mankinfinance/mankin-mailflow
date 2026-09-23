import { TEAM, type TeamMember } from "./team";
import { SignatureSchema, type SignatureSettings } from "./mailflow/settings";

/**
 * Broker email signatures.
 *
 * Microsoft Graph `/me/sendMail` does NOT auto-append the broker's
 * Outlook signature - signatures live in Outlook's UI, not the user's
 * mailbox state, and there's no Graph endpoint that exposes them. So
 * every server-side send needs to append one of its own.
 *
 * We build the signature deterministically from the TEAM roster
 * (name, role, phone, email) plus the Mankin Finance compliance
 * footer (ACR / ACL credit line). The same source produces both an
 * HTML version (for Graph sends with contentType="HTML") and a plain
 * text version (for mailto: links and audit-log notes).
 *
 * The design is fixed here; what goes in it — photos, awards, social
 * links, the disclaimer, each broker's title — is set in Mailflow's
 * Settings (see SignatureSchema). The licence lines are not a setting.
 */

/** Phone-display formatter: "0420699983" -> "0420 699 983". Accepts
 *  numbers that are already formatted. */
function formatAuMobile(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 10 && digits.startsWith("04")) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw;
}

/**
 * Mankin Finance Google review link. Single source of truth so the
 * settlement / congratulations comms (and anywhere else we ask a happy
 * customer for a review) all point at the same place. Update here if the
 * business changes its review destination.
 */
export const MANKIN_REVIEW_URL = "https://share.google/4pkg33Qzcl47fhMHn";

/**
 * One-line, brand-voice review request for the body of a settlement
 * email. Deterministic (never passes through the Claude sanitiser), so
 * it is written correctly by hand: plain Australian English, no
 * exclamation marks, no Americanisms.
 */
export function reviewRequestLine(reviewUrl: string = MANKIN_REVIEW_URL): string {
  return (
    "If you have a spare minute, a short Google review would mean a lot and " +
    "helps other families find us: " +
    reviewUrl
  );
}

/**
 * The firm's credit-licence line, as one string. Exported so the
 * customer-facing pages (the unsubscribe landing) print the same
 * credential as the email signature — a customer checking who we are
 * should not find two different numbers.
 */
export const MANKIN_CREDIT_LINE =
  "Mankin Finance Pty Ltd · Australian Credit Representative 102746 under Australian Credit Licence 390261";

/**
 * The credit-licence lines. On every email, whatever the signature
 * settings say: a credit representative is expected to show its ACR
 * number and its licensee's ACL number, so these are not something a
 * signature redesign can drop. Single source, so a change is one edit.
 */
export const MANKIN_LICENCE_LINES = [
  "Mankin Finance Pty Ltd | Australian Credit Representative 102746",
  "Under Australian Credit Licence 390261 (YBR Aggregation Services)",
];

/* Brand colours. BANNER_NAVY is the address band from the firm's own
   Outlook signature; the rest match the dashboard tokens. */
const BRAND_NAVY = "#1c2566";
const BANNER_NAVY = "#0a0a64";
const LINK_BLUE = "#1a3fb0";
const INK = "#1a1a1a";
const INK_MUTE = "#5a6280";

export interface BrokerSignature {
  /** HTML version - safe for Outlook web + desktop, Gmail, Apple Mail. */
  html: string;
  /** Plain-text version - used as mailto fallback + audit log note. */
  text: string;
}

export interface SignatureOptions {
  /** From Settings. Omitted, the built-in defaults apply. */
  signature?: SignatureSettings;
  /** The firm's postal address, shown in the navy band. */
  postalAddress?: string;
}

function memberFor(brokerId: string): TeamMember {
  return (
    TEAM.find((m) => m.id === brokerId) ??
    /* A missing TEAM row still gets a branded signature with the
       licence lines, rather than a blank one. */
    ({
      id: "fallback",
      name: "Mankin Finance",
      role: "Finance Broker",
      initials: "MF",
      color: BRAND_NAVY,
      short: "Mankin",
      email: "hello@mankinfinance.com",
      phone: "0420 699 983",
    } as TeamMember)
  );
}

/** "https://www.mankinfinance.com.au/" -> "www.mankinfinance.com.au" */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Build a signature pair (HTML + plain text) for the given broker.
 *
 * The layout is the firm's own Outlook signature: sign-off; name, title
 * and firm over a rule; headshot beside phone, email, website, social
 * icons and booking link; a row of award badges; the address in a navy
 * band; the confidentiality note; and the licence lines.
 *
 * Built so an unconfigured part disappears rather than breaks: no photo
 * means no photo column, a social profile with no icon becomes a text
 * link, a broker with no calendar has no booking line, no postal
 * address means no band. Tables and inline styles throughout, because
 * Outlook desktop renders with Word and ignores most modern CSS.
 */
export function signatureFor(
  brokerId: string,
  options: SignatureOptions = {},
): BrokerSignature {
  const sig = options.signature ?? SignatureSchema.parse({});
  const member = memberFor(brokerId);
  const brokerSig = sig.brokers[member.id];
  const title = brokerSig?.title?.trim() || member.role;
  const photoUrl = brokerSig?.photoUrl?.trim() || "";
  const phone = formatAuMobile(member.phone);
  const bookingUrl = member.bookingUrl?.trim() ?? "";
  const address = options.postalAddress?.trim() ?? "";
  const awards = sig.awards.filter((a) => a.imageUrl.trim());

  const socials = [
    { name: "Instagram", url: sig.instagramUrl, icon: sig.instagramIconUrl },
    { name: "LinkedIn", url: sig.linkedinUrl, icon: sig.linkedinIconUrl },
  ].filter((s) => s.url.trim());

  const a = (href: string, text: string, style = `color:${LINK_BLUE};text-decoration:underline;`) =>
    `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(text)}</a>`;
  const glyph = (g: string) =>
    `<span style="color:${BRAND_NAVY};font-size:13px;">${g}</span>&nbsp;`;

  const detailLines = [
    `${glyph("&#9742;")}${a(`tel:${member.phone.replace(/\s+/g, "")}`, phone, `color:${INK};text-decoration:none;`)}`,
    `${glyph("&#9993;")}${a(`mailto:${member.email}`, member.email)}`,
    ...(sig.websiteUrl ? [`${glyph("&#127760;")}${a(sig.websiteUrl, displayUrl(sig.websiteUrl))}`] : []),
  ];

  const socialCell =
    socials.length === 0
      ? ""
      : `<div style="padding:6px 0 2px 0;">${socials
          .map((s) =>
            s.icon.trim()
              ? `<a href="${escapeHtml(s.url)}" style="text-decoration:none;"><img src="${escapeHtml(s.icon)}" width="36" height="36" alt="${s.name}" style="border:0;width:36px;height:36px;vertical-align:middle;"></a>`
              : a(s.url, s.name),
          )
          .join("&nbsp;&nbsp;")}</div>`;

  const bookingLine =
    bookingUrl && sig.bookingLabel
      ? `<div style="padding:8px 0 0 0;font-size:13.5px;">${a(bookingUrl, sig.bookingLabel)}</div>`
      : "";

  const details = [
    `<div style="font-size:13.5px;line-height:1.75;color:${INK};">`,
    detailLines.join("<br>"),
    `</div>`,
    socialCell,
    bookingLine,
  ].join("");

  const detailsRow = photoUrl
    ? [
        `<table cellpadding="0" cellspacing="0" border="0"><tr>`,
        `<td valign="middle" style="padding:0 14px 0 0;border-right:1px solid ${BANNER_NAVY};">`,
        `<img src="${escapeHtml(photoUrl)}" width="150" height="150" alt="${escapeHtml(member.name)}" style="display:block;border:0;width:150px;height:150px;border-radius:75px;">`,
        `</td>`,
        `<td valign="middle" style="padding:0 0 0 14px;">${details}</td>`,
        `</tr></table>`,
      ].join("")
    : details;

  const awardsRow =
    awards.length === 0
      ? ""
      : `<tr><td style="padding:14px 0 8px 0;">${awards
          .map(
            (aw) =>
              `<img src="${escapeHtml(aw.imageUrl)}" height="110" alt="${escapeHtml(aw.alt || "Award")}" style="border:0;height:110px;width:auto;vertical-align:middle;margin:0 14px 0 0;">`,
          )
          .join("")}</td></tr>`;

  const bannerRow = address
    ? `<tr><td bgcolor="${BANNER_NAVY}" style="background-color:${BANNER_NAVY};color:#ffffff;padding:14px 16px;font-size:14px;line-height:1.5;font-style:italic;">${escapeHtml(address)}</td></tr>`
    : "";

  const html = [
    `<table cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif;color:${INK};margin-top:18px;">`,
    sig.signOff ? `<tr><td style="padding:0 0 2px 0;font-size:13.5px;">${escapeHtml(sig.signOff)}</td></tr>` : "",
    `<tr><td style="padding:0 0 6px 0;font-size:13.5px;border-bottom:1px solid ${BANNER_NAVY};"><strong>${escapeHtml(member.name)}</strong> | ${escapeHtml(title)} | Mankin Finance</td></tr>`,
    `<tr><td style="padding:12px 0 4px 0;">${detailsRow}</td></tr>`,
    awardsRow,
    bannerRow,
    sig.disclaimer
      ? `<tr><td style="padding:16px 0 0 0;font-size:12px;line-height:1.55;color:#333333;">${escapeHtml(sig.disclaimer)}</td></tr>`
      : "",
    `<tr><td style="padding:10px 0 0 0;font-size:10.5px;line-height:1.5;color:${INK_MUTE};">${MANKIN_LICENCE_LINES.map(escapeHtml).join("<br>")}</td></tr>`,
    `</table>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    "",
    ...(sig.signOff ? [sig.signOff] : []),
    `${member.name} | ${title} | Mankin Finance`,
    phone,
    member.email,
    ...(sig.websiteUrl ? [displayUrl(sig.websiteUrl)] : []),
    ...socials.map((s) => `${s.name}: ${s.url}`),
    ...(bookingUrl && sig.bookingLabel ? [`${sig.bookingLabel}: ${bookingUrl}`] : []),
    ...(address ? ["", address] : []),
    ...(sig.disclaimer ? ["", sig.disclaimer] : []),
    "",
    ...MANKIN_LICENCE_LINES,
  ].join("\n");

  return { html, text };
}

/* Inline styles reused across the body renderer. Mail clients strip
   <style> blocks, so every element carries its own style attribute. */
const P_STYLE =
  "margin:0 0 12px 0;line-height:1.55;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:#1a1a1a;";
const H_STYLE = `margin:18px 0 6px 0;font-weight:bold;font-size:13.5px;color:${BRAND_NAVY};font-family:Arial,Helvetica,sans-serif;letter-spacing:0.02em;`;
const UL_STYLE =
  "margin:0 0 12px 0;padding:0 0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:#1a1a1a;line-height:1.55;";
const LI_STYLE = "margin:0 0 4px 0;";

/** Render inline emphasis: **bold** -> <strong>. Escapes first so any
 *  literal HTML the broker pasted is rendered as text, not markup. */
function renderInline(s: string): string {
  return escapeHtml(s).replace(
    /\*\*([^*\n]+)\*\*/g,
    (_, inner) =>
      `<strong style="font-weight:bold;color:${BRAND_NAVY};">${inner}</strong>`,
  );
}

/** True when a line is a bullet item (•, -, * leading char). */
function isBullet(line: string): boolean {
  return /^\s*[•\-*]\s+/.test(line);
}

/** True when a line is a section heading: short text that ends with a
 *  colon and contains no sentence terminators before it. Matches the
 *  Mankin template conventions ("Still outstanding:", "If easier:"). */
function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.endsWith(":")) return false;
  if (trimmed.length > 60) return false;
  if (/[.!?]/.test(trimmed.slice(0, -1))) return false;
  return true;
}

/** Strip the bullet character so the <li> renders the text only. */
function bulletText(line: string): string {
  return line.replace(/^\s*[•\-*]\s+/, "");
}

/**
 * Wrap a plain-text body in HTML, preserving paragraph breaks and
 * rendering a small markdown subset:
 *   - **text** becomes <strong> (brand navy)
 *   - Short lines ending with ":" become <h4>-style headers
 *   - Consecutive lines starting with •, -, or * group into <ul>
 *
 * Paired with signatureFor() so the broker's signature lands at the
 * bottom of every send. Bodies that contain none of these markers
 * still render as clean paragraphs — the renderer degrades gracefully.
 */
export function bodyToHtml(plainBody: string): string {
  const lines = plainBody.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paraBuf: string[] = [];
  let listBuf: string[] = [];

  function flushPara() {
    if (paraBuf.length === 0) return;
    const inner = paraBuf.map(renderInline).join("<br>");
    out.push(`<p style="${P_STYLE}">${inner}</p>`);
    paraBuf = [];
  }
  function flushList() {
    if (listBuf.length === 0) return;
    const items = listBuf
      .map((b) => `  <li style="${LI_STYLE}">${renderInline(b)}</li>`)
      .join("\n");
    out.push(`<ul style="${UL_STYLE}">\n${items}\n</ul>`);
    listBuf = [];
  }

  for (const raw of lines) {
    const line = raw;
    if (line.trim() === "") {
      flushList();
      flushPara();
      continue;
    }
    if (isBullet(line)) {
      flushPara();
      listBuf.push(bulletText(line));
      continue;
    }
    if (isHeading(line)) {
      flushList();
      flushPara();
      out.push(`<div style="${H_STYLE}">${renderInline(line.trim())}</div>`);
      continue;
    }
    flushList();
    paraBuf.push(line);
  }
  flushList();
  flushPara();
  return out.join("\n");
}

/**
 * Wrap a draft body in clean HTML ready to send via Graph. Renders the
 * body's markdown subset (bold, headings, bullets) but does NOT append
 * a signature - brokers want their native Outlook signature to land on
 * the draft instead, which they insert in Outlook via Insert signature
 * once the draft opens.
 *
 * Pass `appendAppSignature: true` to force the app-built Mankin
 * signature in cases where the send is fully unattended (background
 * cron / app-only Graph send with no broker session to do the manual
 * insert).
 *
 * brokerId is still required because future variants may key copy off
 * the team roster, and signatureFor() can still be called directly by
 * preview UIs that want to render a signature next to the body.
 */
export function composeHtmlEmail(args: {
  body: string;
  brokerId: string;
  appendAppSignature?: boolean;
  signature?: SignatureOptions;
}): string {
  const parts = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;">`,
    bodyToHtml(args.body),
  ];
  if (args.appendAppSignature) {
    const { html: sigHtml } = signatureFor(args.brokerId, args.signature);
    parts.push(sigHtml);
  }
  parts.push(`</div>`);
  return parts.join("\n");
}

/**
 * Plain-text counterpart for any caller that needs a non-HTML body
 * (audit-log notes, background jobs without HTML capability). Default
 * behaviour matches composeHtmlEmail: signature stays out unless the
 * caller opts in.
 */
export function composePlainEmail(args: {
  body: string;
  brokerId: string;
  appendAppSignature?: boolean;
  signature?: SignatureOptions;
}): string {
  if (!args.appendAppSignature) return args.body.trim();
  const { text: sigText } = signatureFor(args.brokerId, args.signature);
  return `${args.body.trim()}\n${sigText}`;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

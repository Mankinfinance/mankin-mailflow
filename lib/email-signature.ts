import { TEAM, type TeamMember } from "./team";

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
 * Tweaking the signature for everyone: edit MANKIN_FOOTER_LINES or the
 * template below. Tweaking per-broker: add a `signatureOverride` field
 * to TEAM (not yet wired - currently always derives from the standard
 * template so the team looks consistent in the customer's inbox).
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

/** Compliance lines that go under every broker's sign-off. Single source
 *  so when the ACR / ACL changes you update one place. */
const MANKIN_FOOTER_LINES = [
  "Mankin Finance Pty Ltd | Australian Credit Representative 102746",
  "Under Australian Credit Licence 390261 (YBR Aggregation Services)",
  "This email and any attachments are confidential. If you've received it in error, please delete it.",
];

/* Brand colours used in the HTML signature. Match the dashboard tokens
   so the signature reads as Mankin even when rendered by Outlook /
   Gmail / Apple Mail. */
const BRAND_NAVY = "#1c2566";
const INK_MUTE = "#5a6280";
const HAIRLINE = "#d6d8e0";

export interface BrokerSignature {
  /** HTML version - safe for Outlook web + desktop, Gmail, Apple Mail. */
  html: string;
  /** Plain-text version - used as mailto fallback + audit log note. */
  text: string;
}

/**
 * Build a signature pair (HTML + plain text) for the given broker.
 * Falls back to a generic Mankin Finance block when the broker isn't
 * on the TEAM roster.
 */
export function signatureFor(brokerId: string): BrokerSignature {
  const member: TeamMember =
    TEAM.find((m) => m.id === brokerId) ??
    /* Sensible fallback so a missing TEAM row doesn't leave the
       signature blank. The customer still sees Mankin branding +
       compliance footer. */
    ({
      id: "fallback",
      name: "Mankin Finance",
      role: "Finance Broker",
      initials: "MF",
      color: BRAND_NAVY,
      short: "Mankin",
      email: "hello@mankinfinance.com",
      phone: "0420 699 983",
    } as TeamMember);

  const phone = formatAuMobile(member.phone);
  const websiteText = "mankinfinance.com";
  const websiteHref = "https://mankinfinance.com";
  /* Booking line only renders when the team roster has a calendar URL
     for this broker. Empty bookingUrl drops the row entirely so the
     signature stays clean until each broker pastes their link. */
  const bookingUrl = member.bookingUrl?.trim() ?? "";
  const bookingRow = bookingUrl
    ? [
        `  <tr><td style="padding:2px 0 10px 0;font-size:12.5px;">`,
        `    <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};text-decoration:none;font-weight:bold;">📅 Book a meeting with me</a>`,
        `  </td></tr>`,
      ].join("\n")
    : "";

  /* HTML version. Inline styles only - mail clients strip <style>
     blocks. Table-based layout for maximum Outlook compatibility. */
  const html = [
    `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#1a1a1a;">`,
    `  <tr><td style="padding:14px 0 6px 0;border-top:1px solid ${HAIRLINE};">`,
    `    <div style="font-weight:bold;color:${BRAND_NAVY};font-size:14px;">${escapeHtml(member.name)}</div>`,
    `    <div style="color:${INK_MUTE};font-size:12px;">${escapeHtml(member.role)} &middot; Mankin Finance</div>`,
    `  </td></tr>`,
    `  <tr><td style="padding:2px 0 2px 0;font-size:12.5px;">`,
    `    <a href="tel:${encodeURIComponent(member.phone.replace(/\s+/g, ""))}" style="color:${BRAND_NAVY};text-decoration:none;">${escapeHtml(phone)}</a>`,
    `    &nbsp;|&nbsp; `,
    `    <a href="mailto:${escapeHtml(member.email)}" style="color:${BRAND_NAVY};text-decoration:none;">${escapeHtml(member.email)}</a>`,
    `  </td></tr>`,
    `  <tr><td style="padding:2px 0 ${bookingUrl ? "2px" : "10px"} 0;font-size:12.5px;">`,
    `    <a href="${websiteHref}" style="color:${BRAND_NAVY};text-decoration:none;">${websiteText}</a>`,
    `  </td></tr>`,
    bookingRow,
    `  <tr><td style="padding:8px 0 0 0;border-top:1px solid ${HAIRLINE};color:${INK_MUTE};font-size:10.5px;line-height:1.5;">`,
    MANKIN_FOOTER_LINES.map((l) => `    <div>${escapeHtml(l)}</div>`).join("\n"),
    `  </td></tr>`,
    `</table>`,
  ]
    .filter((row) => row !== "")
    .join("\n");

  /* Plain-text version. Used for audit-log notes and any fallback path
     where HTML can't render. */
  const text = [
    "",
    "---",
    member.name,
    `${member.role} | Mankin Finance`,
    `${phone} | ${member.email}`,
    websiteText,
    ...(bookingUrl ? [`Book a meeting: ${bookingUrl}`] : []),
    "",
    ...MANKIN_FOOTER_LINES,
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
}): string {
  const parts = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;">`,
    bodyToHtml(args.body),
  ];
  if (args.appendAppSignature) {
    const { html: sigHtml } = signatureFor(args.brokerId);
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
}): string {
  if (!args.appendAppSignature) return args.body.trim();
  const { text: sigText } = signatureFor(args.brokerId);
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

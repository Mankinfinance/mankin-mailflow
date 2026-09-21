/**
 * Non-delivery report parsing.
 *
 * When a campaign email cannot be delivered, the receiving server sends
 * a bounce message back to the sending mailbox. Graph's sendMail gives
 * us no delivery feedback at all, so reading those messages is the only
 * way we learn that an address is dead — and a back-book carrying
 * addresses collected over years will have plenty.
 *
 * Pure module. Feed it a message's sender, subject and body; it tells
 * you whether it is a bounce, whose address failed, and whether the
 * failure is permanent. Every decision here is deliberately
 * conservative: suppressing someone who is still reachable costs the
 * firm a client relationship, while missing a bounce costs one wasted
 * send. The rules are tuned accordingly.
 */

export type BounceKind = "hard" | "soft";

export interface ParsedBounce {
  /** The address that failed, lower-cased. */
  email: string;
  /** hard = permanent, do not send again. soft = temporary. */
  kind: BounceKind;
  /** The diagnostic line we matched, for the audit trail. */
  diagnostic: string;
  /** Enhanced status code (e.g. "5.1.1") when present. */
  statusCode: string | null;
}

/** Senders that produce non-delivery reports. */
const DAEMON_PATTERN =
  /(^|[<\s])(postmaster|mailer-daemon|mail-daemon|no-reply-bounce|bounce)@/i;

/** Subjects that mark a delivery failure across the common servers. */
const SUBJECT_PATTERNS = [
  /undeliverable/i,
  /delivery status notification/i,
  /delivery has failed/i,
  /mail delivery fail/i,
  /returned mail/i,
  /failure notice/i,
  /message could ?n[o']t be delivered/i,
];

/** Enhanced status code: 5.1.1 (permanent) or 4.2.2 (temporary). */
const ENHANCED_STATUS = /\b([45])\.(\d{1,3})\.(\d{1,3})\b/;

/** Bare SMTP reply code at the start of a diagnostic, e.g. "550 " or "452-". */
const REPLY_CODE = /\b([45])(\d{2})[\s-]/;

const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Codes that mean "this mailbox is over quota", which servers report
 * with both 4.x and 5.x prefixes depending on vendor. A full mailbox is
 * a temporary condition however it is coded — the person still exists —
 * so it is never treated as permanent.
 */
const QUOTA_CODES = new Set(["4.2.2", "5.2.2"]);

/**
 * Codes that are about our own sending reputation rather than the
 * recipient: throttling, greylisting, policy blocks. Suppressing the
 * recipient for these would quietly delete the audience while the real
 * problem is at our end.
 */
const REPUTATION_CODES = new Set([
  "4.7.0", "4.7.1", "4.7.25", "4.7.26", "4.7.28",
  "5.7.1", "5.7.0", "5.7.26", "5.7.28", "5.7.509", "5.7.606",
]);

export interface BounceMessage {
  /** The message's From address. */
  from: string;
  subject: string;
  /** Plain-text body. HTML is fine — tags are ignored by the matching. */
  body: string;
}

/** Does this message look like a non-delivery report at all? */
export function looksLikeBounce(message: BounceMessage): boolean {
  if (DAEMON_PATTERN.test(message.from)) return true;
  return SUBJECT_PATTERNS.some((p) => p.test(message.subject));
}

/**
 * Extract the failed recipient and the severity.
 *
 * `knownRecipients` is the set of addresses we actually mailed. A bounce
 * body quotes the original message, so it contains our own sending
 * address, the support CC, any address in the signature, and often a
 * postmaster contact. Matching against addresses we know we sent to is
 * what stops us suppressing our own support mailbox because it appeared
 * in a quoted footer.
 */
export function parseBounce(
  message: BounceMessage,
  knownRecipients: ReadonlySet<string>,
): ParsedBounce | null {
  if (!looksLikeBounce(message)) return null;

  const email = findFailedRecipient(message.body, knownRecipients);
  if (!email) return null;

  const diagnostic = findDiagnosticLine(message.body, email);
  // Fall back to the whole body for the code: some servers put the
  // address, the human explanation and the numeric status on three
  // different lines, so the best-looking line may carry no code at all.
  const statusCode =
    extractStatusCode(diagnostic ?? "") ?? extractStatusCode(message.body);

  const kind = classify(statusCode, `${diagnostic ?? ""}\n${message.body}`);
  if (!kind) return null;

  return {
    email,
    kind,
    diagnostic: (diagnostic ?? "").slice(0, 400).trim(),
    statusCode,
  };
}

/** The first address in the body that we actually mailed. */
function findFailedRecipient(
  body: string,
  knownRecipients: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>();
  for (const match of body.matchAll(EMAIL)) {
    const candidate = match[0].toLowerCase();
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (knownRecipients.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The line that explains the failure, chosen in descending order of how
 * much it actually tells us.
 *
 * The order matters: an earlier version fell back to any line matching
 * /diagnostic/, which on an Exchange report picks the section heading
 * "Diagnostic information for administrators:" — a line carrying no
 * status code at all, three lines above the one that does.
 */
function findDiagnosticLine(body: string, email: string): string | null {
  const lines = body.split(/\r?\n/);

  // 1. The address and its status code on one line — unambiguous.
  const withBoth = lines.find(
    (l) => l.toLowerCase().includes(email) && ENHANCED_STATUS.test(l),
  );
  if (withBoth) return withBoth;

  // 2. Any line carrying an enhanced status code.
  const withEnhanced = lines.find((l) => ENHANCED_STATUS.test(l));
  if (withEnhanced) return withEnhanced;

  // 3. Any line carrying a bare SMTP reply code.
  const withReply = lines.find((l) => REPLY_CODE.test(l));
  if (withReply) return withReply;

  // 4. A prose explanation, which classify() may still be able to read.
  const withProse = lines.find((l) =>
    /diagnostic|reason|failed|unable to deliver|could ?n[o\']t be delivered/i.test(l),
  );
  return withProse ?? null;
}

function extractStatusCode(text: string): string | null {
  const match = text.match(ENHANCED_STATUS);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/**
 * Permanent or temporary.
 *
 * Returns null when we cannot tell — an unclassifiable bounce is left
 * alone rather than guessed at, because the guess that costs something
 * is the one that suppresses a live address.
 */
function classify(statusCode: string | null, text: string): BounceKind | null {
  if (statusCode) {
    if (QUOTA_CODES.has(statusCode)) return "soft";
    if (REPUTATION_CODES.has(statusCode)) return "soft";
    return statusCode.startsWith("5") ? "hard" : "soft";
  }

  const reply = text.match(REPLY_CODE);
  if (reply) return reply[1] === "5" ? "hard" : "soft";

  // No code anywhere. Some servers send prose only; the phrases below are
  // unambiguous enough to act on, and anything else is left unclassified.
  if (/user unknown|no such user|does ?n[o']t exist|address rejected|unknown recipient/i.test(text)) {
    return "hard";
  }
  if (/mailbox (is )?full|over quota|temporarily unavailable|try again later/i.test(text)) {
    return "soft";
  }
  return null;
}

/**
 * How many soft bounces before an address is treated as dead.
 *
 * A mailbox that is full every time we write to it for three consecutive
 * campaigns is not coming back, but one bad week should not cost a
 * client their updates.
 */
export const SOFT_BOUNCE_LIMIT = 3;

/** Should this address come off the list? */
export function shouldSuppress(
  bounce: ParsedBounce,
  priorSoftBounces: number,
): boolean {
  if (bounce.kind === "hard") return true;
  return priorSoftBounces + 1 >= SOFT_BOUNCE_LIMIT;
}

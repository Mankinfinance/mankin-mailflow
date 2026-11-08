/**
 * Is this email someone asking to stop marketing email?
 *
 * Two ways a client asks by email rather than by the link:
 *  - they write to the unsubscribe mailbox (the mailto: in every
 *    email's List-Unsubscribe header, which Gmail and Outlook offer as
 *    "Unsubscribe"). Anything a person sends there is a request: that is
 *    the mailbox's only purpose.
 *  - they reply "unsubscribe" to the broker. Under the Spam Act an
 *    opt-out has to be honoured however it is made, so these count too.
 *    Brokers' inboxes are full of ordinary mail, so the test is strict:
 *    the subject or the first line of the reply must be the request and
 *    nothing much else. "Stop" on its own counts; "please don't stop
 *    sending these" does not.
 *
 * Either way only the sender's own address is acted on, never an
 * address written in the body: that could be anyone's.
 *
 * Pure, so every rule is tested without a mailbox.
 */

export interface InboundMessage {
  from: string;
  subject: string;
  body: string;
}

/** Mail no person wrote: bounces, out-of-office replies, read receipts. */
const AUTOMATED_SENDER =
  /(^|[<\s])(postmaster|mailer-daemon|mail-daemon|no-?reply|do-?not-?reply|bounces?)[@+]/i;
const AUTOMATED_SUBJECT =
  /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|undeliverable|delivery status notification|read:|not read:|delivered:|returned mail|mail delivery fail)/i;

export function isAutomated(message: InboundMessage): boolean {
  return AUTOMATED_SENDER.test(message.from) || AUTOMATED_SUBJECT.test(message.subject.trim());
}

/** "RE: FW: Re[2]: Your rate review" -> "Your rate review". */
export function stripReplyPrefixes(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 10; i += 1) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|antw)(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s;
}

/** The first line the person typed, above any quoted earlier email. */
export function firstLine(body: string): string {
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Where the quoted original starts: nothing below this was typed now.
    if (/^(>|-{2,}|_{5,}|from:|sent:|on .+wrote:?$)/i.test(line)) return "";
    return line;
  }
  return "";
}

/* The whole of the line, give or take politeness and punctuation:
   "Unsubscribe", "unsubscribe me please", "Please remove me from your
   mailing list", "STOP", "Opt out". Anything longer is a conversation,
   and is left for the broker to read. */
const REQUEST = new RegExp(
  "^(?:hi|hello|hey)?[,!.\\s]*" +
    "(?:please\\s+|pls\\s+|kindly\\s+)?" +
    "(?:unsubscribe|unsub|stop|remove|opt[\\s-]?out|take)" +
    "(?:\\s+me)?" +
    "(?:\\s+(?:off|out))?" +
    "(?:\\s+(?:from|of))?" +
    "(?:\\s+(?:your|the|this|these|all))?" +
    "(?:\\s+(?:mailing|email|marketing))?" +
    "(?:\\s+(?:list|emails?|mailouts?|newsletters?|marketing))?" +
    "(?:\\s*,?\\s*(?:please|pls|thanks|thank\\s+you|thx))?" +
    "[\\s.!]*$",
  "i",
);

export function isUnsubscribeWording(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  // "take" only counts as "take me off ...".
  if (/^(?:\W*(?:please\s+|pls\s+|kindly\s+)?)take\b/i.test(t) && !/\btake\s+me\s+off\b/i.test(t)) return false;
  return REQUEST.test(t);
}

/** A reply in a broker's inbox that asks to unsubscribe. */
export function isUnsubscribeReply(message: InboundMessage): boolean {
  if (isAutomated(message)) return false;
  return (
    isUnsubscribeWording(stripReplyPrefixes(message.subject)) ||
    isUnsubscribeWording(firstLine(message.body))
  );
}

/** A message in the unsubscribe mailbox that a person sent. */
export function isUnsubscribeMailboxRequest(message: InboundMessage): boolean {
  return Boolean(message.from) && !isAutomated(message);
}

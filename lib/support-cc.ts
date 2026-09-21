/**
 * Shared support mailbox that is CC'd on every customer-facing email so
 * the support team keeps a central record of outbound client comms.
 *
 * Applied at the send choke points (delegated broker sends + customer
 * portal reminders). Deliberately NOT applied to one-time passcodes or
 * internal staff notifications — a login code copied to a shared mailbox
 * is a security/noise problem, not a record worth keeping.
 */
export const SUPPORT_CC = "support@mankinfinance.com";

/** Director oversight mailbox — CC'd alongside support on follow-up chases. */
export const MICHAEL_CC = "michael@mankinfinance.com";

/**
 * Addresses CC'd on every customer follow-up chase, regardless of which
 * broker sends it: the shared support mailbox for a central record, and
 * Michael for director oversight of the team's follow-ups.
 */
export const FOLLOWUP_CC_ADDRESSES = [SUPPORT_CC, MICHAEL_CC];

/**
 * Format email recipients for an Outlook `mailto:` link. Outlook desktop
 * separates recipients with a SEMICOLON, not a comma — its "commas can be
 * used to separate multiple recipients" option is off by default — so a
 * comma-joined list (e.g. "support@…, michael@…") drops into the compose
 * window as one broken recipient instead of two. Accepts a comma- or
 * semicolon-separated string, or an array, and returns a `;`-joined list.
 *
 * Graph's /sendMail path does NOT use this — recipients() there splits on
 * both separators — this is only for the mailto compose fallback.
 */
export function mailtoRecipients(list: string | string[]): string {
  const arr = Array.isArray(list) ? list : list.split(/[,;]/);
  return arr
    .map((s) => s.trim())
    .filter(Boolean)
    .join(";");
}

/** The follow-up CC addresses as a comma list, dropping any that are
 *  already the recipient so no one is CC'd on their own email. */
export function followUpCcList(to: string): string[] {
  const toSet = new Set(
    to.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return FOLLOWUP_CC_ADDRESSES.filter((a) => !toSet.has(a.toLowerCase()));
}

/**
 * Append SUPPORT_CC to a comma-separated cc list. De-duplicated, and
 * skipped when support is already a recipient (in `to`) or already CC'd,
 * so it never appears twice. Returns a comma-separated string.
 */
export function withSupportCc(cc: string | undefined, to: string): string {
  const list = (cc ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set(list.map((s) => s.toLowerCase()));
  const toSet = new Set(
    to
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!seen.has(SUPPORT_CC) && !toSet.has(SUPPORT_CC)) {
    list.push(SUPPORT_CC);
  }
  return list.join(", ");
}

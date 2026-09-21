import { TEAM, teamMember } from "./team";

/**
 * Customer-facing closing paragraph. Drops in right above the broker
 * sign-off ("Cheers, Michael") on every templated email — follow-up,
 * anniversary check-ins, etc.
 *
 * Two variants:
 *   - Broker has a calendar bookingUrl set in TEAM: points the customer
 *     to the booking line in the signature.
 *   - Broker has no bookingUrl yet: falls back to "give me a call".
 *
 * Accepts either the TEAM id ("mm") or the short name ("Michael"); some
 * callsites only have one or the other and threading both through every
 * level isn't worth the churn. brokerShort values are unique across the
 * team roster so the lookup is unambiguous. Pure function, no server-
 * only imports - safe in client components.
 */
export function customerClosingFor(opts?: {
  brokerId?: string;
  brokerShort?: string;
}): string {
  const member =
    opts?.brokerId
      ? teamMember(opts.brokerId)
      : opts?.brokerShort
        ? TEAM.find((m) => m.short === opts.brokerShort)
        : undefined;
  const hasBookingLink = !!member?.bookingUrl;
  if (hasBookingLink) {
    return (
      "Hope you've been keeping well. Reply with any questions, or use " +
      "the booking link in my signature below to grab a quick chat."
    );
  }
  return "Hope you've been keeping well. Reply with any questions, or give me a call if it's easier.";
}

import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { maskedEmailOf } from "@/lib/auth/portal-token";

/**
 * The set of contacts a portal OTP code may be sent to for a deal: one per
 * applicant with an email on file. The AuthGate shows the customer this list
 * (masked) so whichever applicant is opening the link can have the code sent
 * to their OWN address, rather than it always going to the primary.
 *
 * SECURITY: the recipient is chosen by INDEX and resolved to the on-file
 * email here, server-side. The client never supplies an email, so a holder
 * of the link cannot redirect the code to an arbitrary address. Both the
 * display (page.tsx) and the send (sendCode) go through this one function so
 * an index always means the same address.
 */
export interface PortalRecipient {
  /** Applicant index; 0 is the primary. Used as the stable selector. */
  index: number;
  /** First name for the "Email <name>" label. */
  name: string;
  /** Real address — SERVER ONLY, never pass this to a client component. */
  email: string;
  /** Masked address for display, e.g. "l****@example.com". */
  maskedEmail: string;
}

function firstNameOf(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "this applicant";
}

export function portalEmailRecipients(deal: Deal): PortalRecipient[] {
  const out: PortalRecipient[] = [];
  const applicants = deal.applicants ?? [];

  // Primary (index 0): the canonical deal.email, falling back to applicant[0].
  const primaryEmail = (deal.email || applicants[0]?.email || "").trim();
  if (primaryEmail) {
    out.push({
      index: 0,
      name: firstNameOf(applicants[0]?.name ?? deal.name),
      email: primaryEmail,
      maskedEmail: maskedEmailOf(primaryEmail),
    });
  }

  // Co-applicants (index 1+): each with an email not already listed.
  for (let i = 1; i < applicants.length; i++) {
    const email = (applicants[i]?.email || "").trim();
    if (!email) continue;
    if (out.some((r) => r.email.toLowerCase() === email.toLowerCase())) continue;
    out.push({
      index: i,
      name: firstNameOf(applicants[i]?.name),
      email,
      maskedEmail: maskedEmailOf(email),
    });
  }

  return out;
}

/** Resolve a client-supplied recipient index back to an on-file address.
 *  Falls back to the primary when the index is missing or out of range, so a
 *  bad value can never send to an off-deal address. */
export function resolvePortalRecipient(
  deal: Deal,
  index: number,
): PortalRecipient | null {
  const recipients = portalEmailRecipients(deal);
  return recipients.find((r) => r.index === index) ?? recipients[0] ?? null;
}

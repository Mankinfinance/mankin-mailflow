import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { dealGreetingFirstName } from "@/lib/deal-subjects";
import {
  issuePortalToken,
  maskedEmailOf,
  mobileSuffixOf,
} from "@/lib/auth/portal-token";

/**
 * Build a customer portal URL for a deal.
 *
 * Mints a fresh 14-day portal token (stateless JWT, no DB write) and
 * frames it as a full link off the public app URL. The customer still
 * verifies via OTP on arrival, so the link is safe to drop into an
 * email the broker is about to send.
 *
 * Shared by the automated email nudge (lib/portal-reminders.ts) and the
 * broker's Composer follow-up drafts so both build the URL the same way.
 */
export function portalBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function portalUrlForDeal(
  deal: Deal,
  issuedBy: string,
): Promise<string> {
  const token = await issuePortalToken({
    dealId: deal.id,
    firstName: dealGreetingFirstName(deal),
    mobileSuffix: mobileSuffixOf(deal.phone),
    maskedEmail: maskedEmailOf(deal.email),
    issuedBy,
  });
  return `${portalBaseUrl()}/portal/${token}`;
}

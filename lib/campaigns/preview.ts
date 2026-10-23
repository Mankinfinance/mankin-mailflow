import { teamMember } from "@/lib/team";
import type { SignatureSettings } from "@/lib/mailflow/settings";
import { renderCampaign, type RenderedCampaign } from "./merge";

/**
 * What a client would receive, drawn in the editor as it is typed.
 *
 * Runs in the browser: renderCampaign is the same function the sender
 * calls, so the preview carries the real signature, licence lines and
 * unsubscribe footer, and a typo in a link or a merge field shows up
 * here rather than in someone's inbox.
 *
 * The client is an example, formatted the way the audience builder
 * formats a real settled loan. The broker is real: the sending broker's
 * name, phone and booking link.
 */
export const PREVIEW_CLIENT: Record<string, string> = {
  first_name: "Sarah",
  last_name: "Chen",
  full_name: "Sarah Chen",
  lender: "Westpac",
  loan_amount: "$620,000",
  current_balance: "$584,300",
  settlement_date: "14 March 2024",
  years_since_settlement: "2",
  loan_status: "Settled",
};

export function previewFields(brokerId: string): Record<string, string> {
  const broker = teamMember(brokerId);
  return {
    ...PREVIEW_CLIENT,
    broker_name: broker.name,
    broker_first_name: broker.short,
    broker_phone: broker.phone,
    broker_email: broker.email,
    booking_url: broker.bookingUrl ?? "",
  };
}

export function previewEmail(input: {
  subject: string;
  body: string;
  brokerId: string;
  signature?: SignatureSettings;
  postalAddress?: string;
}): RenderedCampaign {
  return renderCampaign({
    subject: input.subject,
    body: input.body,
    fields: previewFields(input.brokerId),
    brokerId: input.brokerId,
    // Inert in the preview; the real send gives each person their own.
    links: { unsubscribeUrl: "#unsubscribe" },
    signature: input.signature,
    postalAddress: input.postalAddress,
  });
}

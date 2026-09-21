/**
 * Shared types + constants for the "I can't upload this" portal flow.
 *
 * Lives in its own file (with no server-only imports) so both client
 * components (DocUploader, CustomerFlagBadge) and server modules
 * (flag-action, customer-flags reader) can import the same enum +
 * labels without dragging the DB client into the client bundle.
 */

export type FlagReason =
  | "not-applicable"
  | "still-getting"
  | "no-access"
  | "other";

export const FLAG_REASON_LABEL: Record<FlagReason, string> = {
  "not-applicable": "Doesn't apply to me",
  "still-getting": "Still getting hold of it",
  "no-access": "I don't have access to this",
  other: "Other",
};

export interface CustomerFlag {
  docId: string;
  reason: FlagReason;
  /** Free-text explanation from the customer. Always required, even
   *  when reason is "not-applicable" — the broker still wants to know
   *  why before they mark N/A on the file. */
  explanation: string;
  /** ISO 8601 of when the flag landed. */
  flaggedAt: string;
}

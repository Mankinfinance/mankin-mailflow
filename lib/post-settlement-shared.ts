/**
 * Edge-safe types and constants for the post-settlement queue. Split
 * out from lib/post-settlement.ts (which is server-only) so client
 * components like CheckInCard can import these without dragging in
 * the database client + repo bundle.
 */

export type CheckInKind = "3mo" | "6mo" | "9mo" | "12mo";

export const CHECK_IN_KINDS: CheckInKind[] = ["3mo", "6mo", "9mo", "12mo"];

export const CHECK_IN_LABELS: Record<CheckInKind, string> = {
  "3mo": "3-month check-in",
  "6mo": "6-month check-in",
  "9mo": "9-month check-in",
  "12mo": "1-year check-in",
};

export const CHECK_IN_OFFSET_DAYS: Record<CheckInKind, number> = {
  "3mo": 90,
  "6mo": 180,
  "9mo": 270,
  "12mo": 365,
};

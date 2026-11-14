/** The choices offered, optionally, after someone has unsubscribed. */
export const UNSUBSCRIBE_REASONS = [
  { id: "too-many", label: "Too many emails" },
  { id: "not-relevant", label: "Not relevant to me" },
  { id: "done-with-loan", label: "I've finished with my loan" },
  { id: "never-signed-up", label: "I never asked for these" },
  { id: "other", label: "Something else" },
] as const;

export type UnsubscribeReason = (typeof UNSUBSCRIBE_REASONS)[number]["id"];

export function unsubscribeReasonLabel(id: string | null | undefined): string {
  return UNSUBSCRIBE_REASONS.find((r) => r.id === id)?.label ?? "";
}

import type { Deal } from "@/lib/clients/salestrekker/types";

/**
 * Canonical email subject + greeting conventions across the dashboard.
 *
 * Subject pattern (Mankin house style):
 *   "<Topic> - <NamePart> x Mankin Finance"
 *
 * Examples:
 *   "Deal Enquiry - Sarah Reilly x Mankin Finance"
 *   "3 month check-in - Sarah & Tom Reilly x Mankin Finance"
 *   "End of day update - Bob Smith & Tara Nguyen x Mankin Finance"
 *
 * NamePart rules (mirrors the SharePoint folder naming):
 *   - Single applicant: "Sarah Reilly"
 *   - Joint, shared surname: "Sarah & Tom Reilly" (alphabetical by first name)
 *   - Joint, different surnames: "Sarah Reilly & Tom Smith" (alphabetical)
 *
 * Greeting rules (for "Hi <X>," in the email body):
 *   - Single applicant: first name only — "Sarah"
 *   - Joint applicants: both first names joined with "and" — "Sarah and Tom"
 *   - Three+ applicants: oxford-comma list — "Sarah, Tom and Priya"
 *
 * Edge-safe: no server imports, no external calls. Used from server
 * components, server actions, and client components alike.
 */

interface Applicant {
  first: string;
  last?: string;
}

function parseApplicant(raw: string, fallbackSurname?: string): Applicant | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { first: tokens[0], last: fallbackSurname };
  return { first: tokens[0], last: tokens.slice(1).join(" ") };
}

/**
 * Build the "name part" used in every subject line.
 *
 * Examples:
 *   "Sarah Reilly"                → "Sarah Reilly"
 *   "Sarah & Tom Reilly"          → "Sarah & Tom Reilly" (already sorted)
 *   "Tom & Sarah Reilly"          → "Sarah & Tom Reilly" (sorted)
 *   "Priya & Anish Kumar-Patel"   → "Anish & Priya Kumar-Patel"
 *   "Tara Nguyen & Bob Smith"     → "Bob Smith & Tara Nguyen"
 *   "Cher"                        → "Cher"
 *   ""                            → "the customer" (safe fallback)
 */
export function formatDealNameForSubject(deal: Pick<Deal, "name">): string {
  const raw = (deal.name ?? "").trim();
  if (!raw) return "the customer";

  const parts = raw
    .split(/\s+and\s+|\s*&\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 1) return parts[0];

  // Joint applicants. Parse the second so we can inherit its surname
  // for the first when the broker types e.g. "Sarah & Tom Reilly".
  const second = parseApplicant(parts[1]);
  if (!second) return parts[0];
  const first = parseApplicant(parts[0], second.last);
  if (!first) return parts[1];

  const [a, b] = [first, second].sort((x, y) =>
    x.first.toLowerCase().localeCompare(y.first.toLowerCase()),
  );

  const aSurname = a.last ?? "";
  const bSurname = b.last ?? "";
  const sameSurname =
    aSurname && bSurname && aSurname.toLowerCase() === bSurname.toLowerCase();

  if (sameSurname) return `${a.first} & ${b.first} ${aSurname}`;

  const aFull = aSurname ? `${a.first} ${aSurname}` : a.first;
  const bFull = bSurname ? `${b.first} ${bSurname}` : b.first;
  return `${aFull} & ${bFull}`;
}

/* -------------------------------------------------------------------------- */
/* Greeting first-name builder                                                */
/* -------------------------------------------------------------------------- */

/** Type shape for any "deal-like" input that can carry structured
 *  applicants. Server actions, mocks, and the portal-side render all
 *  reuse this without dragging the full Deal type around. */
type DealLikeWithApplicants = {
  name: string;
  applicants?: Array<{ name: string }>;
};

/**
 * Build the greeting first name(s) for "Hi <X>," at the top of any
 * customer-facing email. Honours joint applicants so Tom doesn't get
 * left off when an email goes to both halves of the couple.
 *
 * Resolution order:
 *   1. Structured deal.applicants — if 2+ entries, join their first
 *      names with "and".
 *   2. Otherwise parse deal.name for an "&"/"and" separator and split
 *      out the first names.
 *   3. Single name → first token.
 *   4. Empty / unparseable → "there" (safe fallback for templates).
 */
export function dealGreetingFirstName(deal: DealLikeWithApplicants): string {
  // Preferred path — structured applicants array. Capped at 4 in the
  // new-application UI; we surface every one of them.
  const applicants = (deal.applicants ?? []).filter(
    (a) => a && typeof a.name === "string" && a.name.trim().length > 0,
  );
  if (applicants.length >= 2) {
    const firsts = applicants
      .map((a) => a.name.trim().split(/\s+/)[0])
      .filter(Boolean);
    return joinWithAnd(firsts);
  }

  // Fallback — parse deal.name for a joint pattern.
  const raw = (deal.name ?? "").trim();
  if (!raw) return "there";
  const parts = raw
    .split(/\s+and\s+|\s*&\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "there";
  if (parts.length === 1) return parts[0].split(/\s+/)[0] || "there";

  const firsts = parts
    .map((p) => p.split(/\s+/)[0])
    .filter(Boolean);
  return joinWithAnd(firsts);
}

/** Join an array with commas + a trailing "and": ["A","B"] → "A and B";
 *  ["A","B","C"] → "A, B and C". */
function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "there";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/* Convenience subject builders                                               */
/* -------------------------------------------------------------------------- */

/** Mankin house-style subject: "<Topic> - <NamePart> x Mankin Finance".
 *  Use this for every customer-facing email subject. Topic is the
 *  short verb phrase the recipient should see first
 *  (e.g. "Deal Enquiry", "3 month check-in", "End of day update"). */
export function subjectWithMankin(
  topic: string,
  deal: Pick<Deal, "name">,
): string {
  return `${topic} - ${formatDealNameForSubject(deal)} x Mankin Finance`;
}

/** First-contact email to a customer asking for docs etc. */
export function dealEnquirySubject(deal: Pick<Deal, "name">): string {
  return subjectWithMankin("Deal Enquiry", deal);
}

/** Any follow-up after first contact has happened. */
export function dealUpdateSubject(deal: Pick<Deal, "name">): string {
  return subjectWithMankin("Deal Update", deal);
}

/** End-of-day status email generated by the 4pm cron. */
export function eodUpdateSubject(deal: Pick<Deal, "name">): string {
  return subjectWithMankin("End of day update", deal);
}

/** End-of-week status email generated by the Friday noon cron. */
export function eowUpdateSubject(deal: Pick<Deal, "name">): string {
  return subjectWithMankin("End of week update", deal);
}

/**
 * Pick the right enquiry-vs-update subject based on whether any prior
 * outbound contact has happened. Callers determine `isFirstContact`
 * however they want (activity count, timeline scan, etc).
 */
export function dealFollowUpSubject(
  deal: Pick<Deal, "name">,
  isFirstContact: boolean,
): string {
  return isFirstContact ? dealEnquirySubject(deal) : dealUpdateSubject(deal);
}

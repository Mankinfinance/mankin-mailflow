/**
 * Mankin Finance team — ported verbatim from
 * design_handoff_lead_followup/design/components/dashboard.jsx (TEAM constant).
 *
 * Avatars use solid background colours rather than uploaded photos so the
 * dashboard renders consistently before each team member has provided a headshot.
 */

/* bookingUrl: paste each broker's calendar link here once they've added
   it to their Outlook signature. LoanFlow no longer injects a signature
   into drafts (brokers Insert signature in Outlook on review), so this
   value is purely a flag for the closing paragraph: set means the
   closing reads "use the booking link in my signature below"; empty
   means it falls back to "give me a call if it's easier". The URL
   itself isn't sent anywhere - it just signals which closing variant
   matches what the customer will see in the Outlook-rendered signature. */
export const TEAM = [
  { id: "mm", name: "Michael Mankin",     role: "Finance Broker",            initials: "MM", color: "#1c2566", short: "Michael",  email: "michael@mankinfinance.com",  phone: "0420 699 983",    bookingUrl: "https://tidycal.com/3qr45gm/30-minute-meeting" },
  { id: "na", name: "Nathan Austin",      role: "Finance Broker",            initials: "NA", color: "#2b6e4f", short: "Nathan",   email: "nathan@mankinfinance.com",   phone: "0412 199 851",    bookingUrl: "" },
  { id: "rl", name: "Robert Lombardo",    role: "Finance Broker",            initials: "RL", color: "#7a3b2a", short: "Robert",   email: "robert@mankinfinance.com",   phone: "0449 573 231",    bookingUrl: "" },
  { id: "ds", name: "Dylan Shacallis",    role: "Finance Broker",            initials: "DS", color: "#4a3a7a", short: "Dylan",    email: "dylan@mankinfinance.com",    phone: "0419 982 337",    bookingUrl: "https://tidycal.com/m2096zl/free-30-minute-consult" },
  { id: "nn", name: "Nick Nissan",        role: "Loan Associate",            initials: "NN", color: "#7a6a2a", short: "Nick",     email: "nick@mankinfinance.com",     phone: "0416 373 573",    bookingUrl: "" },
  { id: "mp", name: "Maddison Phillips",  role: "Loan Associate",            initials: "MP", color: "#7a2a5a", short: "Maddison", email: "maddison@mankinfinance.com", phone: "0466 604 223",    bookingUrl: "" },
  { id: "jp", name: "James Pham",         role: "Finance Broker",            initials: "JP", color: "#2b6e4f", short: "James",    email: "james@mankinfinance.com",    phone: "0431 693 792", bookingUrl: "" },
  { id: "ceo", name: "Client Experience", role: "Client Experience Officer", initials: "CX", color: "#2a6a7a", short: "CX",       email: "experience@mankinfinance.com", phone: "0420 699 996", bookingUrl: "" },
] as const satisfies readonly TeamMember[];

/** TEAM id of the default Client Experience officer. Post-settlement
 *  check-ins are assigned to this person on creation. */
export const CLIENT_EXPERIENCE_OFFICER_ID = "ceo";

/**
 * Set of ids whose role is "Loan Associate". Deals where the primary
 * brokerId is one of these ids are excluded from the shared pipeline
 * queue and from broker-specific views — they only surface when the
 * team filter is explicitly set to that associate.
 */
export const ASSOCIATE_IDS: ReadonlySet<string> = new Set(
  TEAM.filter((m) => m.role === "Loan Associate").map((m) => m.id),
);

export type TeamMemberId = (typeof TEAM)[number]["id"];

export interface TeamMember {
  id: string;
  name: string;
  role: "Finance Broker" | "Loan Associate" | "Client Experience Officer";
  initials: string;
  color: string;
  short: string;
  /** Mankin Finance email. Used for handover CC + send-mail when Graph
   *  /me/sendMail is wired in Phase 7. */
  email: string;
  /** Direct mobile. Used in email sign-offs + handover intros. */
  phone: string;
  /** Calendar booking link (Calendly / MS Bookings / Cal.com). Optional
   *  - when set, the email signature renders a "Book a meeting" line
   *  and customer-facing closing paragraphs point to it. */
  bookingUrl?: string;
}

/** Placeholder team member returned for unknown ids. Lets the UI
 *  render a generic avatar instead of crashing the page. */
const UNKNOWN_TEAM_MEMBER: TeamMember = {
  id: "unknown",
  name: "Unknown",
  role: "Loan Associate",
  initials: "?",
  color: "#9aa0a6",
  short: "?",
  email: "",
  phone: "",
};

/** Sentinel picked in the bulk-backfill form to CLEAR a deal's associate
 *  rather than assign one. A deal with no associate simply doesn't show
 *  in anyone's support queue - which is what you want when a deal was
 *  auto-stamped with the wrong person at creation. Deliberately not a
 *  real team id so it can never collide with one. */
export const UNASSIGN_ASSOCIATE = "__unassign__";

export function teamMember(id: string): TeamMember {
  const m = TEAM.find((t) => t.id === id);
  if (!m) {
    console.warn(`[team] unknown member id "${id}" — using placeholder`);
    return UNKNOWN_TEAM_MEMBER;
  }
  return m;
}

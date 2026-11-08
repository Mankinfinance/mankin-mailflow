import "server-only";
import { cache } from "react";
import { TEAM, type TeamMember, type TeamMemberId } from "@/lib/team";
import { listTeamExtras } from "@/lib/team-extras";
import { authBypassEnabled, emailDomainAllowed } from "@/lib/auth/skip-auth";

/**
 * The signed-in broker — what the dashboard reads to know who's looking.
 *
 * Two modes:
 *  - SKIP_AUTH=true → returns Michael unconditionally (Phase 1 dev mode)
 *  - SKIP_AUTH=false → resolves the broker from the Auth.js session via
 *    Microsoft Entra ID. Matches session email against TEAM by email
 *    (case-insensitive) so brokers configured in Entra map to their
 *    avatar/initials/short name.
 *
 * Perf: wrapped in React's cache() so every server component that calls
 * currentBroker() during a single request shares one auth() lookup +
 * one TEAM resolution. Pages, sidebars, headers and helpers all hit
 * this; without the cache they each pay the JWT parse separately.
 */

export interface CurrentBroker {
  id: TeamMemberId;
  name: string;
  short: string;
  role: "Finance Broker" | "Loan Associate" | "Client Experience Officer";
  email: string;
  initials: string;
  /** CSS hex used for avatar background */
  avatarColor: string;
}

// Email → team id. Update when actual broker mailboxes are confirmed.
// Both .com and .com.au forms supported so the dashboard maps the
// signed-in email correctly regardless of which TLD the Mankin Finance
// Microsoft tenant uses.
const EMAIL_TO_TEAM: Record<string, TeamMemberId> = {
  "michael@mankinfinance.com": "mm",
  "michael@mankinfinance.com.au": "mm",
  "nathan@mankinfinance.com": "na",
  "nathan@mankinfinance.com.au": "na",
  "robert@mankinfinance.com": "rl",
  "robert@mankinfinance.com.au": "rl",
  "dylan@mankinfinance.com": "ds",
  "dylan@mankinfinance.com.au": "ds",
  "nick@mankinfinance.com": "nn",
  "nick@mankinfinance.com.au": "nn",
  "maddison@mankinfinance.com": "mp",
  "maddison@mankinfinance.com.au": "mp",
  "james@mankinfinance.com": "jp",
  "james@mankinfinance.com.au": "jp",
};

/**
 * Who someone is when Mailflow does not know them: no session, or an
 * account that is not on the team. Not a team id, so every permission
 * check (canAccessAdmin, canAccessCx) answers no, and the layout sends
 * them to /no-access.
 */
export const NO_ACCESS_ID = "no-access";
const NO_ACCESS: CurrentBroker = {
  id: NO_ACCESS_ID as TeamMemberId,
  name: "No access",
  short: "No access",
  role: "Loan Associate",
  email: "",
  initials: "?",
  avatarColor: "#8a8d96",
};

export const currentBroker = cache(async function currentBroker(): Promise<CurrentBroker> {
  // Mocked broker only in dev with an explicit SKIP_AUTH=true. On every
  // deployment (NODE_ENV=production) this is false, so the real Auth.js
  // path always runs — a missing/typo'd env var can't silently mock the
  // broker in production. Matches the gate in auth.config.ts.
  if (authBypassEnabled()) {
    const michael = TEAM.find((m) => m.id === "mm");
    if (!michael) throw new Error("Mock broker 'mm' missing from TEAM table");
    return toCurrentBroker(michael, "michael@mankinfinance.com");
  }

  // Lazy import to keep auth.config.ts off the client bundle and to defer
  // the next-auth peer-dep resolution until we actually need it.
  const { auth } = await import("@/auth");
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();

  /* No session: nobody. This used to fall back to Michael, and since
     Michael is the Master Admin, anything that reached a server action
     without a session ran with full access. */
  if (!email) return NO_ACCESS;

  // Try the email map first.
  let memberId: string | undefined = EMAIL_TO_TEAM[email];
  let resolvedMember: TeamMember | undefined;

  // If unmatched, try matching the local part of the email against any
  // team member's email (handles minor TLD variation the map didn't
  // anticipate, e.g. "michael@mankin.com.au" matching the "michael"
  // local part).
  // Only for a recognised Mankin-domain email — otherwise a stranger whose
  // address happens to share a broker's local-part (e.g. james@elsewhere.com)
  // could be mapped to that broker.
  if (!memberId && emailDomainAllowed(email)) {
    const localPart = email.split("@")[0];
    const matched = TEAM.find(
      (m) => m.email.split("@")[0].toLowerCase() === localPart,
    );
    if (matched) memberId = matched.id;
  }

  // Runtime-added extras: check team_extras by exact email match.
  // Lets new staff added via /dashboard/setup sign in and resolve to
  // their own identity rather than falling back to Michael.
  if (!memberId) {
    const extras = await listTeamExtras();
    const extraMatch =
      extras.find((m) => m.email.toLowerCase() === email) ??
      (emailDomainAllowed(email)
        ? extras.find(
            (m) => m.email.split("@")[0].toLowerCase() === email.split("@")[0],
          )
        : undefined);
    if (extraMatch) {
      memberId = extraMatch.id;
      resolvedMember = extraMatch;
    }
  }

  /* Signed in, but not someone Mailflow knows: no access. Never Michael
     (see above). Add them to the team in LoanFlow's Setup to let them in. */
  if (!memberId) {
    console.warn(`[currentBroker] signed-in email ${email} is not on the team; no access.`);
    return NO_ACCESS;
  }

  const member = resolvedMember ?? TEAM.find((m) => m.id === memberId);
  if (!member) {
    console.warn(`[currentBroker] resolved id ${memberId} but no member found; no access.`);
    return NO_ACCESS;
  }
  return toCurrentBroker(member, email);
});

function toCurrentBroker(
  member: TeamMember,
  email: string,
): CurrentBroker {
  return {
    id: member.id as TeamMemberId,
    name: member.name,
    short: member.short,
    role: member.role,
    email,
    initials: member.initials,
    avatarColor: member.color,
  };
}

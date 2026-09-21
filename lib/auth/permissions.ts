import "server-only";
import type { TeamMemberId } from "@/lib/team";
import { listTeamPermissions } from "@/lib/team-permissions";

/**
 * Role checks for LoanFlow.
 *
 * Defaults:
 *   - Master Admin: Michael ("mm"). Always admin + CX. Cannot be
 *     demoted via the UI (the floor below makes sure of it).
 *   - CX Manager: Michael only by default. Grant access to anyone
 *     else via /dashboard/setup → Permissions panel.
 *   - Everyone else: brokers + associates with day-to-day access only.
 *
 * Runtime overrides:
 *   The team_permissions table in Postgres lets Michael grant extra
 *   access at runtime via /dashboard/setup. Rows there ADD permissions
 *   on top of the defaults; they never remove Michael's floor.
 *
 *   Wire: the canAccess* helpers below read from listTeamPermissions
 *   (cached per request) and union the result with the static defaults.
 *
 * Async note: these helpers are now async because they consult Postgres.
 * Every caller is already in an async server component or server action
 * so this is a transparent change at the call site - just add `await`.
 */

/** Single global Master Admin id (Michael Mankin). */
export const MASTER_ADMIN_ID: TeamMemberId = "mm";

/** Default CX-permitted ids when no override row exists. Locked to
 *  Michael only - grant access to anyone else (CX/Settlement Officer,
 *  brokers, associates) from /dashboard/setup → Permissions, where
 *  each row has a Can access CX checkbox. */
const DEFAULT_CX_ALLOWED: ReadonlySet<TeamMemberId> = new Set<TeamMemberId>([
  "mm",
]);

/** Default admin-permitted ids. Just the Master Admin. */
const DEFAULT_ADMIN_ALLOWED: ReadonlySet<TeamMemberId> = new Set<TeamMemberId>([
  "mm",
]);

/** True when the supplied id is the Master Admin. Sync since it's a
 *  literal constant compare - safe to use in non-async contexts. */
export function isMasterAdmin(brokerId: string): boolean {
  return brokerId === MASTER_ADMIN_ID;
}

/** True when the supplied id can reach the admin / setup surface. */
export async function canAccessAdmin(brokerId: string): Promise<boolean> {
  if (DEFAULT_ADMIN_ALLOWED.has(brokerId as TeamMemberId)) return true;
  const overrides = await listTeamPermissions();
  return overrides.some((r) => r.teamId === brokerId && r.isAdmin);
}

/** True when the supplied id can use the CX Manager. */
export async function canAccessCx(brokerId: string): Promise<boolean> {
  if (DEFAULT_CX_ALLOWED.has(brokerId as TeamMemberId)) return true;
  const overrides = await listTeamPermissions();
  return overrides.some((r) => r.teamId === brokerId && r.canAccessCx);
}

/** Effective permissions for a single team member. Used by the setup
 *  UI to render the right checkbox states. The Master Admin floor is
 *  applied here too so the UI shows them locked. */
export async function effectivePermissions(brokerId: string): Promise<{
  isMasterAdmin: boolean;
  isAdmin: boolean;
  canAccessCx: boolean;
  disabled: boolean;
  locked: boolean;
}> {
  if (brokerId === MASTER_ADMIN_ID) {
    return {
      isMasterAdmin: true,
      isAdmin: true,
      canAccessCx: true,
      disabled: false,
      locked: true,
    };
  }
  const overrides = await listTeamPermissions();
  const row = overrides.find((r) => r.teamId === brokerId);
  const defaultAdmin = DEFAULT_ADMIN_ALLOWED.has(brokerId as TeamMemberId);
  const defaultCx = DEFAULT_CX_ALLOWED.has(brokerId as TeamMemberId);
  return {
    isMasterAdmin: false,
    isAdmin: defaultAdmin || (row?.isAdmin ?? false),
    canAccessCx: defaultCx || (row?.canAccessCx ?? false),
    disabled: row?.disabled ?? false,
    locked: false,
  };
}

/** True when the supplied id has been disabled via the setup page.
 *  The Master Admin is never disabled - the floor is enforced at the
 *  write side too (setUserDisabledAction refuses) but we double-check
 *  here so a stray DB row can't lock Michael out. */
export async function isUserDisabled(brokerId: string): Promise<boolean> {
  if (brokerId === MASTER_ADMIN_ID) return false;
  const overrides = await listTeamPermissions();
  const row = overrides.find((r) => r.teamId === brokerId);
  return row?.disabled ?? false;
}

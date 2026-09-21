import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { teamPermissions, type TeamPermissionRow } from "./db/schema";
import {
  TEAM_PERMISSIONS_TAG,
  revalidateTeamPermissions,
} from "./team-permissions-cache";

/**
 * Runtime team permission overrides.
 *
 * The defaults in lib/auth/permissions.ts (Michael = admin + CX,
 * CX officer = CX) are baked in for safety. This module lets Michael
 * grant additional access at runtime via /dashboard/setup without a
 * redeploy.
 *
 * Storage: the `team_permissions` table. Rows are sparse - only team
 * members with NON-default access need a row. Missing row = defaults.
 *
 * Master Admin floor: Michael ("mm") is always admin + CX regardless
 * of what's in the table. Prevents an admin from accidentally locking
 * themselves out.
 */

export interface TeamPermissionOverride {
  teamId: string;
  isAdmin: boolean;
  canAccessCx: boolean;
  disabled: boolean;
}

/** Raw DB read of every override row, with the missing-table/column
 *  fallbacks. Wrapped by the two cache layers below. */
async function fetchTeamPermissions(): Promise<TeamPermissionOverride[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const db = getDb();
    const rows = await db.select().from(teamPermissions);
    return rows.map((r: TeamPermissionRow) => ({
      teamId: r.teamId,
      isAdmin: r.isAdmin,
      canAccessCx: r.canAccessCx,
      disabled: r.disabled ?? false,
    }));
  } catch (err) {
    /* Missing table is the most common reason this fails - happens
       when the deployment hasn't run the 0004 migration yet. Fall
       back to empty list so the hardcoded defaults take over and
       the dashboard keeps working. */
    if ((err as { code?: string })?.code === "42P01") return [];
    /* Missing 'disabled' column (older deployment, migration 0010
       not yet applied) — same fallback: empty list, defaults win,
       no crash. */
    if ((err as { code?: string })?.code === "42703") return [];
    console.error("[team-permissions] read failed", err);
    return [];
  }
}

/** Cross-request cached override rows (tag-invalidated on every permission
 *  write). This is the layer that keeps the layout's per-navigation
 *  permission check off the cross-region Supabase round-trip. */
const getCachedTeamPermissions = unstable_cache(
  fetchTeamPermissions,
  ["team-permissions-list-v1"],
  { tags: [TEAM_PERMISSIONS_TAG], revalidate: 300 },
);

/** Fetch every override row. Two cache layers stack, mirroring the deal
 *  store: React cache() dedupes within one request (the layout's
 *  isUserDisabled + the Sidebar's canAccessAdmin share one fetch), and
 *  unstable_cache persists it across requests so navigations skip the DB. */
export const listTeamPermissions = cache(
  async (): Promise<TeamPermissionOverride[]> => getCachedTeamPermissions(),
);

const CREATE_TEAM_PERMISSIONS_TABLE = sql`
  CREATE TABLE IF NOT EXISTS "team_permissions" (
    "team_id"      text        PRIMARY KEY,
    "is_admin"     boolean     NOT NULL DEFAULT false,
    "can_access_cx" boolean    NOT NULL DEFAULT false,
    "disabled"     boolean     NOT NULL DEFAULT false,
    "updated_at"   timestamptz NOT NULL DEFAULT now(),
    "updated_by"   text        NOT NULL
  )
`;

async function ensureTeamPermissionsTable(): Promise<void> {
  await getDb().execute(CREATE_TEAM_PERMISSIONS_TABLE);
}

/** Upsert one row. Always stamps updatedAt + updatedBy. */
export async function setTeamPermission(args: {
  teamId: string;
  isAdmin: boolean;
  canAccessCx: boolean;
  disabled?: boolean;
  updatedBy: string;
}): Promise<void> {
  const run = async () => {
    const db = getDb();
    await db
      .insert(teamPermissions)
      .values({
        teamId: args.teamId,
        isAdmin: args.isAdmin,
        canAccessCx: args.canAccessCx,
        disabled: args.disabled ?? false,
        updatedBy: args.updatedBy,
      })
      .onConflictDoUpdate({
        target: teamPermissions.teamId,
        set: {
          isAdmin: args.isAdmin,
          canAccessCx: args.canAccessCx,
          disabled: args.disabled ?? false,
          updatedBy: args.updatedBy,
          updatedAt: new Date(),
        },
      });
  };
  try {
    await run();
  } catch (err) {
    if ((err as { code?: string })?.code !== "42P01") throw err;
    await ensureTeamPermissionsTable();
    await run();
  }
  revalidateTeamPermissions();
}

/** Flip just the disabled bit without touching isAdmin / canAccessCx.
 *  Used by Remove access / Restore access on the setup page. */
export async function setUserDisabled(args: {
  teamId: string;
  disabled: boolean;
  updatedBy: string;
}): Promise<void> {
  const db = getDb();
  const run = async (): Promise<void> => {
    /* Read current row (if any) so we preserve their existing
       isAdmin/canAccessCx grants. Disable shouldn't silently strip
       other access. */
    const existing = await db
      .select()
      .from(teamPermissions)
      .where(eq(teamPermissions.teamId, args.teamId))
      .limit(1);
    const current = existing[0];
    await db
      .insert(teamPermissions)
      .values({
        teamId: args.teamId,
        isAdmin: current?.isAdmin ?? false,
        canAccessCx: current?.canAccessCx ?? false,
        disabled: args.disabled,
        updatedBy: args.updatedBy,
      })
      .onConflictDoUpdate({
        target: teamPermissions.teamId,
        set: {
          disabled: args.disabled,
          updatedBy: args.updatedBy,
          updatedAt: new Date(),
        },
      });
  };
  try {
    await run();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "42P01") {
      /* Table doesn't exist yet — create it and retry. */
      await ensureTeamPermissionsTable();
      await run();
      revalidateTeamPermissions();
      return;
    }
    /* 42703 = disabled column missing (migration 0005 not yet applied). */
    if (code !== "42703") throw err;
    await db.execute(sql`
      ALTER TABLE "team_permissions"
        ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL;
    `);
    await run();
  }
  revalidateTeamPermissions();
}

/** Remove an override row - team member reverts to default access. */
export async function clearTeamPermission(teamId: string): Promise<void> {
  const db = getDb();
  try {
    await db.delete(teamPermissions).where(eq(teamPermissions.teamId, teamId));
    revalidateTeamPermissions();
  } catch (err) {
    /* Table doesn't exist — nothing to delete, treat as success. */
    if ((err as { code?: string })?.code === "42P01") return;
    throw err;
  }
}

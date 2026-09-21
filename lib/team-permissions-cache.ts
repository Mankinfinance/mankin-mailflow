import "server-only";
import { updateTag, revalidateTag } from "next/cache";

/**
 * Data-cache tag for the runtime team-permission overrides.
 *
 * The dashboard layout blocks on a permission check (isUserDisabled +
 * canAccessAdmin) before rendering every page, which resolves to a
 * listTeamPermissions() read. Left uncached across requests that was a
 * cross-region Supabase round-trip on every navigation. The read layer
 * (team-permissions.ts) now tags its unstable_cache entry with this;
 * permission writes bust it. Read and write halves share this module so
 * they can't drift apart. Mirrors lib/deal-cache.ts.
 */
export const TEAM_PERMISSIONS_TAG = "team-permissions";

/**
 * Invalidate the cached permission list. Called from the permission write
 * methods (setTeamPermission / setUserDisabled / clearTeamPermission), which
 * only run inside the /dashboard/setup server actions. updateTag expires the
 * entry immediately so the admin sees their own change on the next render;
 * revalidateTag is the route-handler fallback; no request scope no-ops.
 */
export function revalidateTeamPermissions(): void {
  try {
    updateTag(TEAM_PERMISSIONS_TAG);
  } catch {
    try {
      revalidateTag(TEAM_PERMISSIONS_TAG, "max");
    } catch {
      /* no request scope — nothing cached to invalidate */
    }
  }
}

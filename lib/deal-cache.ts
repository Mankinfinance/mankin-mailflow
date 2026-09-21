import "server-only";
import { updateTag, revalidateTag } from "next/cache";

/**
 * Data-cache tag for the persisted deal list.
 *
 * The cross-request cached read layer (imported-deals-store.ts) tags its
 * unstable_cache entry with this; every deal write busts it so the next
 * read re-fetches from Postgres. Read and write halves share this module
 * so they can't drift apart.
 */
export const DEALS_TAG = "deals";

/**
 * Invalidate the cached deal list. Called from the deal repo's write
 * methods — the single choke point every mutation flows through, whether
 * via the imported-deals-store helpers or a direct repos().deal.upsert()
 * in a server action. Hooking invalidation there (not at the ~30 call
 * sites) makes staleness correct-by-construction: no write can skip it.
 *
 * Next 16 changed tag invalidation, so we pick the right primitive per
 * context:
 *  - Server Actions (where 100% of interactive deal edits happen) use
 *    updateTag — it EXPIRES the entry immediately, so the re-render that
 *    follows the action reads fresh data (true read-your-own-writes). A
 *    broker who changes a stage sees the new stage instantly, never a
 *    stale one.
 *  - Route Handlers / cron can't call updateTag; they fall back to
 *    revalidateTag(tag, "max"), stale-while-revalidate, which is fine for
 *    background writes nobody is watching in real time.
 *  - No request scope at all (CLI scripts, unit tests writing straight to
 *    the repo) — both throw and we no-op, since nothing is serving a
 *    cached response to go stale.
 */
export function revalidateDeals(): void {
  try {
    updateTag(DEALS_TAG);
  } catch {
    try {
      revalidateTag(DEALS_TAG, "max");
    } catch {
      /* no request scope — nothing cached to invalidate */
    }
  }
}

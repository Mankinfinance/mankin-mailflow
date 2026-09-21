import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { repos, parseDealData, type ImportMeta } from "./db/repos";
import { DEALS_TAG } from "./deal-cache";
import type { Deal } from "./clients/salestrekker/types";

/**
 * Persistent deal store. Backs the dashboard's deal dataset with
 * either Postgres (when MOCK_DB=false) or an in-memory Map (when
 * MOCK_DB=true). Same async API in both modes so callers don't have
 * to care which one is active.
 *
 * Source of truth for deals created via "+ New application" and
 * uploaded via /dashboard/import. The Salestrekker mock client
 * checks this store first, falling back to MOCK_DEALS for its seed
 * dataset when the store is empty.
 *
 * Previous in-memory-only behaviour lost deals on every Vercel cold
 * start; the Postgres backend fixes that.
 *
 * Perf: two cache layers stack on the deal read.
 *
 *  1. React cache() dedupes calls within a SINGLE request, so the
 *     Sidebar, PageHeader, page body, EOD brief button and today queue
 *     share one fetch instead of firing five.
 *  2. unstable_cache persists the fetch ACROSS requests in Next's data
 *     cache, tagged DEALS_TAG. Every deal write busts the tag (see
 *     revalidateDeals in the deal repo) — via updateTag from server
 *     actions, so a broker's edit shows immediately on the next render
 *     (read-your-own-writes). Navigations between edits skip the
 *     cross-region Supabase round-trip the "1" layer alone still paid.
 *
 * The cross-request layer caches raw JSON payloads, not parsed Deals:
 * Deal carries Date fields Next's serialisation would mangle, so Zod
 * parsing runs per request AFTER the cache via parseDealData. The parse
 * is cheap next to the DB round-trip the cache removes. The 5-minute
 * revalidate is a safety net — even a missed invalidation self-heals.
 */

export type { ImportMeta };

/** Cross-request cached raw deal payloads (JSON-only, tag-invalidated). */
const getCachedRawDeals = unstable_cache(
  () => repos().deal.listRaw(),
  ["imported-deals-list-v1"],
  { tags: [DEALS_TAG], revalidate: 300 },
);

/** Read every persisted deal, newest first by updated_at. React cache()
 *  dedupes within one request; raw payloads come from the cross-request
 *  data cache and are parsed here. */
export const getImportedDeals = cache(async (): Promise<Deal[]> => {
  const raw = await getCachedRawDeals();
  return raw
    .map((r) => parseDealData(r.id, r.data))
    .filter((d): d is Deal => d !== null);
});

/** True when the store has at least one deal. Shares the cached
 *  getImportedDeals fetch so we don't fire a separate COUNT(*) query. */
export async function hasImportedDeals(): Promise<boolean> {
  const deals = await getImportedDeals();
  return deals.length > 0;
}

/** Most recent import session meta (filename + row count + when), or null. */
export async function getLastImport(): Promise<ImportMeta | null> {
  return repos().deal.lastImport();
}

/** Replace the entire dataset with the supplied deals. Records an
 *  import session in deal_imports so the import page can show the
 *  "last import" meta. Returns the row count. */
export async function replaceImportedDeals(args: {
  deals: Deal[];
  importedBy: string;
  filename: string;
}): Promise<number> {
  const count = await repos().deal.replaceAll(args.deals);
  await repos().deal.recordImport({
    importedBy: args.importedBy,
    filename: args.filename,
    rowCount: count,
  });
  return count;
}

/** Update a single deal in the store. Idempotent. */
export async function updateImportedDeal(deal: Deal): Promise<void> {
  await repos().deal.upsert(deal);
}

/** Add a new deal (typically from the New Application flow). */
export async function addImportedDeal(deal: Deal): Promise<void> {
  await repos().deal.add(deal);
}

/** Find one by id, or null. Wrapped in React cache() so repeated
 *  single-deal lookups within one request (e.g. a server action that
 *  reads the deal, mutates it, then reads it again) share one query. */
export const getImportedDeal = cache(
  async (id: string): Promise<Deal | null> => repos().deal.get(id),
);

/** Wipe the store. Used by the import page's "Clear import" action. */
export async function clearImportedDeals(): Promise<void> {
  await repos().deal.clear();
}

/** Remove a single deal from the store. Used by the Delete button on
 *  the deal drawer when a deal was created in error / is a duplicate. */
export async function deleteImportedDeal(id: string): Promise<void> {
  await repos().deal.remove(id);
}

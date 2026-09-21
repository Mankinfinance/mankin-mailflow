import "server-only";
import { unstable_cache } from "next/cache";
import { repos } from "@/lib/db/repos";
import { MILESTONE_COMM_ACTION, handledKeysFromEvents } from "@/lib/milestone-queue";

/**
 * Milestone-comm "handled" keys, cached ~30s across requests.
 *
 * The Sidebar badge re-renders on every dashboard navigation AND on every
 * inline-edit router.refresh(), and it used to fire a fresh Postgres audit
 * query (limit 5000) each time — a cross-region round-trip on the hot edit
 * path, which is what made editing feel laggy. The handled set only changes
 * when a broker sends/dismisses a milestone comm, so a few seconds of
 * staleness on a nav badge count is immaterial. The action surfaces
 * (control-tower / milestone-comms pages) keep querying directly so they
 * stay exact.
 *
 * Only the derived keys (plain strings) are cached — never Date objects —
 * so there's nothing for JSON serialisation to mangle.
 */
export const getMilestoneHandledKeys = unstable_cache(
  async (): Promise<string[]> => {
    const events = await repos().audit.list({
      action: MILESTONE_COMM_ACTION,
      limit: 5000,
    });
    return [...handledKeysFromEvents(events)];
  },
  ["milestone-handled-keys-v1"],
  { revalidate: 30 },
);

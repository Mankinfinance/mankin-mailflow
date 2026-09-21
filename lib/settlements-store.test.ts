import { describe, it, expect } from "vitest";
import {
  recordReview,
  listReviews,
  purgeOrphanedReviews,
} from "./settlements-store";

/**
 * Covers purgeOrphanedReviews against the in-memory review store (the
 * default when MOCK_DB is unset). purge operates on the whole store, so
 * each test derives its valid-id set from the current contents to stay
 * independent of any rows other tests left behind.
 */
describe("purgeOrphanedReviews", () => {
  it("removes only reviews whose settlement is no longer in the back-book", async () => {
    const p = "PURGE-A-";
    // Everything already in the store stays valid; only our two "gone" ids
    // are excluded from the back-book.
    const preIds = (await listReviews()).map((r) => r.settlementId);
    await recordReview({ settlementId: `${p}keep`, milestone: 3, milestoneDate: "2025-01-01", state: "booked", actionedBy: "ceo" });
    await recordReview({ settlementId: `${p}gone1`, milestone: 6, milestoneDate: "2025-02-01", state: "emailed", actionedBy: "ceo" });
    await recordReview({ settlementId: `${p}gone2`, milestone: 12, milestoneDate: "2025-03-01", state: "booked", actionedBy: "ceo" });

    const removed = await purgeOrphanedReviews([...preIds, `${p}keep`]);
    expect(removed).toBe(2);

    const remaining = (await listReviews()).filter((r) => r.settlementId.startsWith(p));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].settlementId).toBe(`${p}keep`);
  });

  it("keeps everything when all settlements are still present", async () => {
    const p = "PURGE-B-";
    await recordReview({ settlementId: `${p}x`, milestone: 3, milestoneDate: "2025-01-01", state: "booked", actionedBy: "ceo" });
    const allIds = (await listReviews()).map((r) => r.settlementId);
    const removed = await purgeOrphanedReviews(allIds);
    expect(removed).toBe(0);
    expect((await listReviews()).some((r) => r.settlementId === `${p}x`)).toBe(true);
  });
});

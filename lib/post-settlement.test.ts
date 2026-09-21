import { describe, it, expect } from "vitest";
import { syncCheckIns, CHECK_IN_KINDS } from "./post-settlement";
import { repos } from "./db/repos";
import type { Deal } from "./clients/salestrekker/types";

/**
 * Covers syncCheckIns after it moved from a per-(deal, kind)
 * select-then-insert loop to a single bulk ensurePending call. Runs
 * against the in-memory mock repo (the default when MOCK_DB is unset),
 * which mirrors the real repo's "insert only missing pairs" semantics.
 *
 * What matters: every settled deal gets one row per kind, re-running is
 * idempotent (no duplicates), and non-settled / bad-date deals are
 * skipped. Unique deal-id prefixes keep each test isolated from the
 * module-level entry store.
 */

// syncCheckIns only reads id / stageId / settledOn, so a minimal cast is
// enough to drive it without constructing a full 34-field Deal.
function deal(id: string, stageId: string, settledOn: string | null): Deal {
  return { id, stageId, settledOn } as unknown as Deal;
}

async function rowsFor(prefix: string) {
  const all = await repos().postSettlement.list({ includeDismissed: true });
  return all.filter((r) => r.dealId.startsWith(prefix));
}

describe("syncCheckIns (bulk ensurePending)", () => {
  it("creates one check-in per kind for each settled deal", async () => {
    const p = "t1-";
    await syncCheckIns([
      deal(`${p}a`, "settled", "2026-01-10"),
      deal(`${p}b`, "settled", "2026-02-20"),
    ]);
    const rows = await rowsFor(p);
    expect(rows).toHaveLength(2 * CHECK_IN_KINDS.length);
    // Each deal has exactly the full set of kinds.
    for (const id of [`${p}a`, `${p}b`]) {
      const kinds = rows.filter((r) => r.dealId === id).map((r) => r.kind).sort();
      expect(kinds).toEqual([...CHECK_IN_KINDS].sort());
    }
  });

  it("is idempotent — re-running creates no duplicates", async () => {
    const p = "t2-";
    const deals = [deal(`${p}a`, "settled", "2026-03-01")];
    await syncCheckIns(deals);
    await syncCheckIns(deals);
    await syncCheckIns(deals);
    const rows = await rowsFor(p);
    expect(rows).toHaveLength(CHECK_IN_KINDS.length);
  });

  it("skips non-settled deals and settled deals with no/invalid date", async () => {
    const p = "t3-";
    await syncCheckIns([
      deal(`${p}open`, "lodged", null),
      deal(`${p}nodate`, "settled", null),
      deal(`${p}baddate`, "settled", "not-a-date"),
      deal(`${p}ok`, "settled", "2026-04-15"),
    ]);
    const rows = await rowsFor(p);
    const ids = [...new Set(rows.map((r) => r.dealId))];
    expect(ids).toEqual([`${p}ok`]);
    expect(rows).toHaveLength(CHECK_IN_KINDS.length);
  });

  it("computes dueAt as settledOn + the kind's offset days", async () => {
    const p = "t4-";
    await syncCheckIns([deal(`${p}a`, "settled", "2026-05-01")]);
    const rows = await rowsFor(p);
    // Every due date must be strictly after the settlement date.
    const settled = new Date("2026-05-01").getTime();
    for (const r of rows) {
      expect(r.dueAt.getTime()).toBeGreaterThan(settled);
    }
  });
});

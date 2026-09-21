import { describe, it, expect } from "vitest";
import {
  currentRatesFromEvents,
  topLendersForBand,
  lastRateUpdate,
  LENDER_RATE_SEED,
} from "./lender-rates";

describe("currentRatesFromEvents", () => {
  it("returns the seed when there are no events", () => {
    const cur = currentRatesFromEvents([]);
    expect(cur.get("macquarie")?.lvr60).toBe(LENDER_RATE_SEED.macquarie.lvr60);
    expect(cur.get("macquarie")?.updatedAt).toBeNull();
  });

  it("overrides the seed with the newest event per lender", () => {
    const cur = currentRatesFromEvents([
      // newest-first, as the audit repo returns them
      { meta: { lenderId: "westpac", lvr60: 5.8, lvr70: 5.9, lvr80: 6.0 }, createdAt: "2026-07-15T00:00:00Z", actorId: "mm" },
      { meta: { lenderId: "westpac", lvr60: 6.5, lvr70: 6.6, lvr80: 6.7 }, createdAt: "2026-06-01T00:00:00Z", actorId: "mm" },
    ]);
    const wbc = cur.get("westpac")!;
    expect(wbc.lvr60).toBe(5.8); // newest wins
    expect(wbc.updatedAt).toBe("2026-07-15T00:00:00Z");
    expect(wbc.updatedBy).toBe("mm");
  });
});

describe("topLendersForBand", () => {
  it("ranks the lowest rates first and caps at n", () => {
    const cur = currentRatesFromEvents([]);
    const top = topLendersForBand(cur, "lvr60", 3);
    expect(top).toHaveLength(3);
    expect(top[0].rank).toBe(1);
    // Macquarie 5.94 is the sharpest ≤60% rate in the seed.
    expect(top[0].lenderName).toBe("Macquarie");
    // Sorted ascending.
    expect(top[0].rate).toBeLessThanOrEqual(top[1].rate);
    expect(top[1].rate).toBeLessThanOrEqual(top[2].rate);
  });

  it("reflects an edit that takes a lender to the top", () => {
    const cur = currentRatesFromEvents([
      { meta: { lenderId: "cba", lvr80: 5.5, lvr70: 5.6, lvr60: 5.4 }, createdAt: "2026-07-20T00:00:00Z", actorId: "mm" },
    ]);
    const top = topLendersForBand(cur, "lvr80", 1);
    expect(top[0].lenderName).toBe("Commonwealth Bank");
    expect(top[0].rate).toBe(5.5);
  });
});

describe("lastRateUpdate", () => {
  it("is null on the pure seed and set once edited", () => {
    expect(lastRateUpdate(currentRatesFromEvents([]))).toBeNull();
    const cur = currentRatesFromEvents([
      { meta: { lenderId: "anz", lvr60: 6.0, lvr70: 6.1, lvr80: 6.2 }, createdAt: "2026-07-18T00:00:00Z", actorId: "mm" },
    ]);
    expect(lastRateUpdate(cur)?.lenderName).toBe("ANZ");
  });
});

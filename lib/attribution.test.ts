import { describe, it, expect } from "vitest";
import {
  buildSourceAttribution,
  buildSourceTrend,
  bestConvertingSource,
  UNATTRIBUTED,
} from "./attribution";
import type { Deal } from "./clients/salestrekker/types";

/**
 * The attribution helpers only read stageId, nurturedAt, leadSource,
 * loanAmount and settledOn, so tests build just those fields and cast —
 * keeping the fixtures readable rather than repeating the full Deal shape.
 */
function deal(p: {
  stageId: Deal["stageId"];
  leadSource?: string;
  loanAmount?: number | null;
  nurturedAt?: string | null;
  settledOn?: string | null;
}): Deal {
  return {
    stageId: p.stageId,
    leadSource: p.leadSource ?? "",
    loanAmount: p.loanAmount ?? null,
    nurturedAt: p.nurturedAt ?? null,
    settledOn: p.settledOn ?? null,
  } as unknown as Deal;
}

describe("buildSourceAttribution", () => {
  const deals = [
    deal({ stageId: "settled", leadSource: "BNI", loanAmount: 600_000 }),
    deal({ stageId: "settled", leadSource: "BNI", loanAmount: 400_000 }),
    deal({ stageId: "pre-lodge", leadSource: "BNI", loanAmount: 500_000 }),
    deal({ stageId: "settled", leadSource: "Instagram", loanAmount: 300_000 }),
    deal({ stageId: "lodged", leadSource: "Instagram", loanAmount: 350_000 }),
    deal({ stageId: "pre-lodge", leadSource: "Instagram" }),
    deal({ stageId: "pre-lodge", leadSource: "  " }), // whitespace -> unattributed
    deal({ stageId: "lodged" }), // empty -> unattributed
    // Nurtured, not settled -> excluded from the funnel entirely
    deal({ stageId: "pre-lodge", leadSource: "BNI", nurturedAt: "2026-01-01" }),
  ];

  const attr = buildSourceAttribution(deals);

  it("groups by channel and folds blank sources into Unattributed", () => {
    const sources = attr.rows.map((r) => r.source);
    expect(sources).toContain("BNI");
    expect(sources).toContain("Instagram");
    expect(sources).toContain(UNATTRIBUTED);
    expect(attr.sourceCount).toBe(2); // BNI + Instagram, not Unattributed
    expect(attr.unattributed).toBe(2); // the whitespace + empty deals
  });

  it("excludes nurtured (parked) deals from the funnel", () => {
    const bni = attr.rows.find((r) => r.source === "BNI")!;
    // 2 settled + 1 open (pre-lodge); the nurtured BNI deal is dropped.
    expect(bni.settled).toBe(2);
    expect(bni.open).toBe(1);
    expect(bni.total).toBe(3);
  });

  it("computes settled value, average loan and settled rate", () => {
    const bni = attr.rows.find((r) => r.source === "BNI")!;
    expect(bni.settledValue).toBe(1_000_000);
    expect(bni.avgSettledLoan).toBe(500_000);
    expect(bni.settledRate).toBeCloseTo(2 / 3, 5);
    expect(bni.openPipelineValue).toBe(500_000);
  });

  it("sorts channels by settled value descending", () => {
    // BNI ($1.0M settled) ranks above Instagram ($0.3M) above Unattributed ($0).
    const attributed = attr.rows.map((r) => r.source);
    expect(attributed.indexOf("BNI")).toBeLessThan(attributed.indexOf("Instagram"));
    expect(attributed.indexOf("Instagram")).toBeLessThan(
      attributed.indexOf(UNATTRIBUTED),
    );
  });

  it("totals across all channels", () => {
    // 3 settled (BNI×2 + Instagram×1); 5 open (BNI×1 + Instagram×2 +
    // unattributed×2); the nurtured BNI deal is excluded.
    expect(attr.totals.settled).toBe(3);
    expect(attr.totals.open).toBe(5);
    expect(attr.totals.total).toBe(8);
    expect(attr.totals.settledValue).toBe(1_300_000);
  });
});

describe("buildSourceTrend", () => {
  const now = new Date("2026-07-15T00:00:00Z");

  it("buckets settled value by month and source within the window", () => {
    const trend = buildSourceTrend(
      [
        deal({ stageId: "settled", leadSource: "BNI", loanAmount: 500_000, settledOn: "2026-07-02" }),
        deal({ stageId: "settled", leadSource: "BNI", loanAmount: 300_000, settledOn: "2026-06-20" }),
        deal({ stageId: "settled", leadSource: "Instagram", loanAmount: 400_000, settledOn: "2026-07-10" }),
      ],
      now,
      6,
    );
    expect(trend.months).toHaveLength(6);
    expect(trend.months[trend.months.length - 1].label).toBe("Jul 26");

    const bni = trend.series.find((s) => s.source === "BNI")!;
    const jul = trend.months.length - 1;
    const jun = trend.months.length - 2;
    expect(bni.monthly[jul]).toBe(500_000);
    expect(bni.monthly[jun]).toBe(300_000);
    expect(bni.monthlyCount[jul]).toBe(1);
    expect(bni.total).toBe(800_000);
    // Ranked by total: BNI (800k) before Instagram (400k).
    expect(trend.series[0].source).toBe("BNI");
    expect(trend.max).toBe(500_000);
  });

  it("excludes unattributed, unsettled, and out-of-window settlements", () => {
    const trend = buildSourceTrend(
      [
        deal({ stageId: "settled", leadSource: "", loanAmount: 500_000, settledOn: "2026-07-02" }), // no source
        deal({ stageId: "pre-lodge", leadSource: "BNI", loanAmount: 500_000 }), // not settled
        deal({ stageId: "settled", leadSource: "BNI", loanAmount: 500_000, settledOn: "2025-01-01" }), // too old
      ],
      now,
      6,
    );
    expect(trend.series).toHaveLength(0);
  });
});

describe("bestConvertingSource", () => {
  it("ignores channels below the minimum deal floor", () => {
    const attr = buildSourceAttribution([
      // A single 1-of-1 settlement would be 100% — must not win at minDeals=2.
      deal({ stageId: "settled", leadSource: "Fluke", loanAmount: 500_000 }),
      deal({ stageId: "settled", leadSource: "Referral", loanAmount: 500_000 }),
      deal({ stageId: "settled", leadSource: "Referral", loanAmount: 500_000 }),
      deal({ stageId: "pre-lodge", leadSource: "Referral" }),
    ]);
    const best = bestConvertingSource(attr, 2);
    expect(best?.source).toBe("Referral"); // 2/3, cleared the floor
  });

  it("returns null when no channel clears the floor", () => {
    const attr = buildSourceAttribution([
      deal({ stageId: "settled", leadSource: "Solo", loanAmount: 500_000 }),
    ]);
    expect(bestConvertingSource(attr, 2)).toBeNull();
  });
});

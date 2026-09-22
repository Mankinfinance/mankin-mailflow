import { describe, it, expect } from "vitest";
import { bestPerformingLink, buildClickMap, shortUrl } from "./click-map";

const BOOK = "https://tidycal.com/mankinfinance";
const RATES = "https://mankinfinance.com/rates";
const IMG = "https://app.example.com/api/files/abc";

describe("buildClickMap", () => {
  it("lists links in the order they appear in the body", () => {
    const map = buildClickMap({
      body: `Hi,\n\n[Check rates](${RATES})\n\n[Book a time](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 9 }, { url: RATES, clicks: 3 }],
      delivered: 100,
    });
    expect(map.rows.map((r) => r.label)).toEqual(["Check rates", "Book a time"]);
    expect(map.rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("gives each link its share of the clicks and of the audience", () => {
    const map = buildClickMap({
      body: `[Check rates](${RATES})\n[Book a time](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 9 }, { url: RATES, clicks: 3 }],
      delivered: 100,
    });
    const book = map.rows.find((r) => r.url === BOOK)!;
    expect(map.totalClicks).toBe(12);
    expect(book.shareOfClicks).toBeCloseTo(75);
    expect(book.clickRate).toBeCloseTo(9);
  });

  it("reports an unclicked link as zero clicks, not as missing", () => {
    const map = buildClickMap({
      body: `[Check rates](${RATES})\n[Book a time](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 4 }],
      delivered: 50,
    });
    const rates = map.rows.find((r) => r.url === RATES)!;
    expect(rates.clicks).toBe(0);
    expect(rates.shareOfClicks).toBe(0);
  });

  it("leaves share unknown when nothing was clicked at all", () => {
    // Zero share would imply this link lost a contest that never ran.
    const map = buildClickMap({
      body: `[Book a time](${BOOK})`,
      clicks: [],
      delivered: 80,
    });
    expect(map.totalClicks).toBe(0);
    expect(map.rows[0].shareOfClicks).toBeNull();
  });

  it("does not treat an image as a clickable link", () => {
    // ![alt](url) matches the link pattern too. A row for it would be a
    // link no reader could ever have clicked.
    const map = buildClickMap({
      body: `![Our rates](${IMG})\n\n[Book a time](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 2 }],
      delivered: 40,
    });
    expect(map.rows).toHaveLength(1);
    expect(map.rows[0].url).toBe(BOOK);
  });

  it("flags a URL used twice, because the two share one count", () => {
    // Clicks are recorded per URL, not per occurrence — neither
    // position can be credited separately.
    const map = buildClickMap({
      body: `[Book now](${BOOK})\n\nOr later: [book a time](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 10 }],
      delivered: 100,
    });
    expect(map.rows).toHaveLength(2);
    expect(map.rows.every((r) => r.sharedCount)).toBe(true);
    expect(map.rows[0].clicks).toBe(10);
    expect(map.rows[1].clicks).toBe(10);
  });

  it("does not flag a single-use URL as shared", () => {
    const map = buildClickMap({
      body: `[Book a time](${BOOK})\n[Rates](${RATES})`,
      clicks: [],
      delivered: 10,
    });
    expect(map.rows.every((r) => !r.sharedCount)).toBe(true);
  });

  it("keeps clicks on a URL no longer in the body", () => {
    // The body was edited after sending. Dropping these would make the
    // shares add up to less than the clicks that happened.
    const map = buildClickMap({
      body: `[Book a time](${BOOK})`,
      clicks: [
        { url: BOOK, clicks: 5 },
        { url: "https://old.example.com/offer", clicks: 7 },
      ],
      delivered: 100,
    });
    expect(map.orphanedClicks).toEqual([
      { url: "https://old.example.com/offer", clicks: 7 },
    ]);
    expect(map.totalClicks).toBe(12);
  });

  it("copes with a body that has no links", () => {
    const map = buildClickMap({ body: "Just a note.", clicks: [], delivered: 5 });
    expect(map.rows).toEqual([]);
    expect(map.totalClicks).toBe(0);
  });

  it("leaves the click rate unknown when nothing was delivered", () => {
    const map = buildClickMap({
      body: `[Book a time](${BOOK})`,
      clicks: [],
      delivered: 0,
    });
    expect(map.rows[0].clickRate).toBeNull();
  });
});

describe("bestPerformingLink", () => {
  it("picks the most-clicked link", () => {
    const map = buildClickMap({
      body: `[Rates](${RATES})\n[Book](${BOOK})`,
      clicks: [{ url: BOOK, clicks: 9 }, { url: RATES, clicks: 3 }],
      delivered: 100,
    });
    expect(bestPerformingLink(map)?.label).toBe("Book");
  });

  it("returns nothing when no link was clicked", () => {
    const map = buildClickMap({
      body: `[Book](${BOOK})`,
      clicks: [],
      delivered: 100,
    });
    expect(bestPerformingLink(map)).toBeNull();
  });
});

describe("shortUrl", () => {
  it("drops the scheme and a bare trailing slash", () => {
    expect(shortUrl("https://tidycal.com/")).toBe("tidycal.com");
    expect(shortUrl("https://mankinfinance.com/rates")).toBe("mankinfinance.com/rates");
  });

  it("truncates a long path", () => {
    const long = shortUrl(`https://example.com/${"a".repeat(80)}`);
    expect(long.length).toBeLessThanOrEqual(46);
    expect(long.endsWith("…")).toBe(true);
  });

  it("shows an unparseable URL as written rather than hiding it", () => {
    expect(shortUrl("not a url")).toBe("not a url");
  });
});

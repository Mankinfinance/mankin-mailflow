/**
 * Which links in a campaign were actually clicked.
 *
 * Mailchimp draws this over a picture of the rendered email. That works
 * because their bodies are built from positioned blocks; ours is
 * written text, so there are no coordinates to draw on and inventing
 * some would be decoration rather than information.
 *
 * What a broker needs from a click map is the same either way: for each
 * link, in the order it appears in the email they wrote, how much of
 * the campaign's attention it got. So this returns the links in body
 * order with their share, and the UI lays them out against the body
 * text around them.
 *
 * Pure module — body and click rows in, rows out.
 */

/** Mirrors the renderer's link pattern. Kept in step deliberately: a
 *  link the renderer would not turn into an anchor is not a link a
 *  reader could have clicked. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Images use the same shape and are stripped first, exactly as the
 *  renderer does — an image is not a link and was never clickable. */
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g;

export interface ClickMapRow {
  /** 1-based, in the order the link appears in the body. */
  position: number;
  label: string;
  url: string;
  clicks: number;
  /** Share of all link clicks in this campaign. Null when there were
   *  none at all — zero would imply this link lost a contest that never
   *  took place. */
  shareOfClicks: number | null;
  /** Clicks as a share of delivered recipients. */
  clickRate: number | null;
  /**
   * True when this URL appears more than once in the body.
   *
   * Clicks are recorded per URL, not per occurrence, so two links to
   * the same address share one count and neither can be credited
   * separately. Saying so beats quietly showing the same number twice.
   */
  sharedCount: boolean;
}

export interface ClickMap {
  rows: ClickMapRow[];
  totalClicks: number;
  /** Links that were clicked but are no longer in the body — the body
   *  was edited after the send, or the campaign was copied. */
  orphanedClicks: Array<{ url: string; clicks: number }>;
}

/**
 * Build the map.
 *
 * `delivered` is the count the click rate is against — recipients the
 * send actually reached, not everyone resolved into the audience.
 */
export function buildClickMap(args: {
  body: string;
  clicks: Array<{ url: string; clicks: number }>;
  delivered: number;
}): ClickMap {
  const byUrl = new Map<string, number>();
  for (const row of args.clicks) {
    byUrl.set(row.url, (byUrl.get(row.url) ?? 0) + row.clicks);
  }

  /* Strip images before looking for links: `![alt](url)` matches the
     link pattern too, and counting one as a clickable link would put a
     row in the map that no reader could ever have clicked. */
  const withoutImages = args.body.replace(MARKDOWN_IMAGE, "");

  const found: Array<{ label: string; url: string }> = [];
  for (const match of withoutImages.matchAll(MARKDOWN_LINK)) {
    found.push({ label: match[1], url: match[2] });
  }

  const occurrences = new Map<string, number>();
  for (const link of found) {
    occurrences.set(link.url, (occurrences.get(link.url) ?? 0) + 1);
  }

  const totalClicks = [...byUrl.values()].reduce((sum, n) => sum + n, 0);

  const rows: ClickMapRow[] = found.map((link, i) => {
    const clicks = byUrl.get(link.url) ?? 0;
    return {
      position: i + 1,
      label: link.label,
      url: link.url,
      clicks,
      shareOfClicks: totalClicks > 0 ? (clicks / totalClicks) * 100 : null,
      clickRate: args.delivered > 0 ? (clicks / args.delivered) * 100 : null,
      sharedCount: (occurrences.get(link.url) ?? 0) > 1,
    };
  });

  /* A click on a URL no longer in the body still happened — the body was
     edited after sending, or this campaign was copied from another.
     Dropping it would make the shares add up to less than the clicks. */
  const inBody = new Set(found.map((l) => l.url));
  const orphanedClicks = [...byUrl.entries()]
    .filter(([url]) => !inBody.has(url))
    .map(([url, clicks]) => ({ url, clicks }))
    .sort((a, b) => b.clicks - a.clicks);

  return { rows, totalClicks, orphanedClicks };
}

/** The link that did the most work, for the report's one-line summary. */
export function bestPerformingLink(map: ClickMap): ClickMapRow | null {
  const clicked = map.rows.filter((r) => r.clicks > 0);
  if (clicked.length === 0) return null;
  return clicked.reduce((best, row) => (row.clicks > best.clicks ? row : best));
}

/** Tidy a URL for display: the host and a truncated path. */
export function shortUrl(raw: string, maxLength = 46): string {
  let display = raw;
  try {
    const url = new URL(raw);
    display = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    /* Not parseable — show it as written rather than hiding it. */
  }
  return display.length > maxLength
    ? `${display.slice(0, maxLength - 1)}…`
    : display;
}

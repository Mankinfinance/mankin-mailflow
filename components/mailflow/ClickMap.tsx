import { CircleAlert, MousePointerClick } from "lucide-react";
import type { ClickMap as ClickMapData } from "@/lib/campaigns/click-map";
import { shortUrl } from "@/lib/campaigns/click-map";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * Where the clicks went.
 *
 * A table rather than a chart: there are rarely more than five links,
 * each carries a long label and a URL, and the reader needs the count
 * and the rate as well as the comparison. A bar behind each row gives
 * the at-a-glance ranking a chart would have, without giving up the
 * numbers or the text.
 *
 * Length is the whole encoding, so one hue does it — a colour ramp
 * across five rows would imply a category that is not there.
 */

export function ClickMap({
  map,
  delivered,
}: {
  map: ClickMapData;
  delivered: number;
}) {
  if (map.rows.length === 0 && map.orphanedClicks.length === 0) return null;

  const max = Math.max(1, ...map.rows.map((r) => r.clicks));

  return (
    <Card>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <Eyebrow>Where the clicks went</Eyebrow>
        <span className="text-[11px] text-ink-faint">
          {map.totalClicks} {map.totalClicks === 1 ? "click" : "clicks"} across{" "}
          {map.rows.length} {map.rows.length === 1 ? "link" : "links"}
        </span>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-mute">
        In the order the links appear in the email, so the shape of the message
        reads alongside what it earned.
      </p>

      {map.rows.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-ink-mute">
          This campaign has no links in its body.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {map.rows.map((row) => (
            <li key={`${row.position}-${row.url}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="mono shrink-0 text-[10px] text-ink-faint">
                    {row.position}
                  </span>
                  <span className="truncate text-[12.5px] font-semibold text-ink">
                    {row.label}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                  <strong className="font-semibold text-brand">{row.clicks}</strong>
                  {row.clickRate !== null && (
                    <span className="text-ink-mute"> · {row.clickRate.toFixed(1)}%</span>
                  )}
                </span>
              </div>

              {/* Length is the encoding; the bar is the ranking at a
                  glance, the numbers above are the detail. */}
              <div
                className="mt-1 h-[6px] w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--color-paper-warm)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(row.clicks > 0 ? 2 : 0, (row.clicks / max) * 100)}%`,
                    backgroundColor: "#161461",
                  }}
                />
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="mono truncate text-[10.5px] text-ink-faint">
                  {shortUrl(row.url)}
                </span>
                {row.sharedCount && (
                  <span
                    title="This address appears more than once in the body. Clicks are recorded per address, so both occurrences share this count."
                    className="shrink-0 text-[10px] text-ink-faint"
                  >
                    shared count
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {map.orphanedClicks.length > 0 && (
        <div
          className="mt-3.5 rounded-md border px-3 py-2"
          style={{ backgroundColor: "#fbf8f1", borderColor: "#e8ddc6" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <CircleAlert size={12} strokeWidth={1.8} style={{ color: "#8a6d2f" }} />
            <span className="text-[11.5px] font-semibold text-ink">
              Clicks on links no longer in the body
            </span>
          </div>
          <p className="mb-1.5 text-[10.5px] leading-relaxed text-ink-mute">
            The body was edited after this went out, so these cannot be matched
            to a position. They are counted in the total.
          </p>
          <ul className="flex flex-col gap-0.5">
            {map.orphanedClicks.map((o) => (
              <li
                key={o.url}
                className="flex items-baseline justify-between gap-3 text-[10.5px]"
              >
                <span className="mono truncate text-ink-mute">{shortUrl(o.url)}</span>
                <span className="shrink-0 tabular-nums text-ink-soft">{o.clicks}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {map.totalClicks === 0 && map.rows.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-mute">
          <MousePointerClick size={12} strokeWidth={1.8} className="shrink-0" />
          Nothing clicked yet
          {delivered > 0 ? ` out of ${delivered} delivered.` : "."}
        </p>
      )}
    </Card>
  );
}

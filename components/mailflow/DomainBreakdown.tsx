import { CircleAlert } from "lucide-react";
import {
  MIN_FOR_RATE,
  describeOutlier,
  type DomainBreakdown as Breakdown,
} from "@/lib/campaigns/domains";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * Open rate by mail provider.
 *
 * A table with a bar in it rather than a bar chart, because the
 * denominator is half the information: "Gmail 11%" means one thing on
 * 300 recipients and nothing at all on nine. A bare chart would show
 * both bars the same height and invite the same conclusion.
 *
 * Rows under the readable floor show their counts and no rate. That is
 * the point rather than a gap — a number withheld is more honest than
 * one that cannot bear the weight a reader will put on it.
 */

export function DomainBreakdown({ breakdown }: { breakdown: Breakdown }) {
  if (breakdown.rows.length === 0) return null;

  const outlier = describeOutlier(breakdown);
  const scale = Math.max(
    100,
    ...breakdown.rows.map((r) => r.openRate ?? 0),
  );

  return (
    <Card>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <Eyebrow>Opens by mail provider</Eyebrow>
        {breakdown.baselineOpenRate !== null && (
          <span className="text-[11px] text-ink-faint">
            {breakdown.baselineOpenRate.toFixed(1)}% overall
          </span>
        )}
      </div>
      <p className="mb-3 max-w-[560px] text-[11.5px] leading-relaxed text-ink-mute">
        The one view Google Postmaster will not give you at this volume. What
        it answers is whether a provider is treating this mail differently from
        the rest — not whether the writing landed.
      </p>

      <table className="w-full">
        <thead>
          <tr>
            <Th>Provider</Th>
            <Th align="right">Sent</Th>
            <Th align="right">Opened</Th>
            <Th>Open rate</Th>
            <Th align="right">Clicked</Th>
          </tr>
        </thead>
        <tbody>
          {breakdown.rows.map((row) => {
            const belowBaseline =
              row.openRate !== null &&
              breakdown.baselineOpenRate !== null &&
              row.openRate < breakdown.baselineOpenRate / 2;

            return (
              <tr
                key={row.provider}
                className="border-t"
                style={{ borderColor: "var(--color-hairline-softer)" }}
              >
                <td className="py-2 pr-3">
                  <span className="text-[12.5px] font-semibold text-ink">
                    {row.provider}
                  </span>
                  {row.provider === "Other" && row.distinctDomains > 1 && (
                    <span className="mt-0.5 block text-[10px] text-ink-faint">
                      {row.distinctDomains} domains
                    </span>
                  )}
                  {row.failed > 0 && (
                    <span className="mt-0.5 block text-[10px] text-ink-faint">
                      {row.failed} did not send
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-ink-soft">
                  {row.sent}
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-ink-soft">
                  {row.opened}
                </td>
                <td className="w-[38%] py-2 pr-3">
                  {row.openRate === null ? (
                    <span className="text-[11px] text-ink-faint">
                      too few to read
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span
                        className="h-[6px] flex-1 overflow-hidden rounded-full"
                        style={{ backgroundColor: "var(--color-paper-warm)" }}
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (row.openRate / scale) * 100)}%`,
                            /* Status, not category: a provider far below
                               the rest is a state worth flagging, and it
                               ships with the "well below" label below
                               rather than relying on colour alone. */
                            backgroundColor: belowBaseline ? "#8a4b48" : "#161461",
                          }}
                        />
                      </span>
                      <span className="w-[42px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink">
                        {row.openRate.toFixed(1)}%
                      </span>
                    </span>
                  )}
                </td>
                <td className="py-2 text-right text-[12px] tabular-nums text-ink-soft">
                  {row.clickRate === null ? "—" : `${row.clickRate.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-faint">
        A rate needs at least {MIN_FOR_RATE} recipients before it is shown. Below
        that one extra open moves it too far to mean anything.
      </p>

      {outlier && (
        <div
          className="mt-3 flex gap-2 rounded-md border px-3 py-2.5"
          style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
        >
          <CircleAlert
            size={13}
            strokeWidth={1.8}
            className="mt-px shrink-0"
            style={{ color: "#8a4b48" }}
          />
          <p className="text-[11.5px] leading-relaxed text-ink-soft">{outlier}</p>
        </div>
      )}
    </Card>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-faint"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

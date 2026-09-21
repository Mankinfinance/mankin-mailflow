import type { Deal } from "./clients/salestrekker/types";

/**
 * Lead-source attribution — turns each deal's `leadSource` into a
 * channel-level funnel so the business can see which sources actually
 * settle, not just which generate enquiries. This is the number an ops
 * manager needs to decide where to spend time and referral effort.
 *
 * Pure over the deal list, so it works identically on the mock dataset
 * today and on the live Salestrekker feed once the CRM is connected —
 * nothing here changes when the data source does.
 *
 * Metric honesty: `settledRate` is settled ÷ (open + settled) for a
 * channel — i.e. the share of that channel's *known* deals that have
 * settled. Deals still in flight count against it, so it reads low while
 * a channel's pipeline is young. It sharpens into a true win-rate once we
 * also track lost / declined deals (a later horizon); until then it's a
 * directional comparison between channels, which is what matters for
 * allocation decisions.
 */

export const UNATTRIBUTED = "Unattributed";

export interface SourceRow {
  /** Channel label. Empty / whitespace lead sources collapse to "Unattributed". */
  source: string;
  /** Active deals still in flight (non-nurtured, not yet settled). */
  open: number;
  /** Deals that have settled. */
  settled: number;
  /** open + settled — the base for settledRate. */
  total: number;
  /** Sum of settled loan amounts (AUD). */
  settledValue: number;
  /** Sum of open-deal loan amounts where known (AUD). */
  openPipelineValue: number;
  /** Average settled loan size (AUD), 0 when nothing settled. */
  avgSettledLoan: number;
  /** settled / total, 0..1. 0 when the channel has no deals. */
  settledRate: number;
}

export interface SourceAttribution {
  /** One row per channel, sorted by settled value desc, then total desc. */
  rows: SourceRow[];
  totals: {
    open: number;
    settled: number;
    total: number;
    settledValue: number;
    openPipelineValue: number;
  };
  /** Count of deals (open + settled) with no usable lead source. */
  unattributed: number;
  /** Number of distinct *attributed* channels (excludes Unattributed). */
  sourceCount: number;
}

function blankRow(source: string): SourceRow {
  return {
    source,
    open: 0,
    settled: 0,
    total: 0,
    settledValue: 0,
    openPipelineValue: 0,
    avgSettledLoan: 0,
    settledRate: 0,
  };
}

export function buildSourceAttribution(deals: Deal[]): SourceAttribution {
  const map = new Map<string, SourceRow>();
  const ensure = (source: string): SourceRow => {
    let row = map.get(source);
    if (!row) {
      row = blankRow(source);
      map.set(source, row);
    }
    return row;
  };

  for (const d of deals) {
    const isSettled = d.stageId === "settled";
    const isNurtured = d.nurturedAt !== null;
    // Parked (nurtured, not settled) deals sit outside the active funnel —
    // excluding them keeps conversion honest, matching the rest of the app.
    if (!isSettled && isNurtured) continue;

    const source = (d.leadSource || "").trim() || UNATTRIBUTED;
    const row = ensure(source);
    if (isSettled) {
      row.settled += 1;
      row.settledValue += d.loanAmount ?? 0;
    } else {
      row.open += 1;
      row.openPipelineValue += d.loanAmount ?? 0;
    }
  }

  const rows = [...map.values()];
  for (const row of rows) {
    row.total = row.open + row.settled;
    row.avgSettledLoan = row.settled > 0 ? Math.round(row.settledValue / row.settled) : 0;
    row.settledRate = row.total > 0 ? row.settled / row.total : 0;
  }

  rows.sort(
    (a, b) =>
      b.settledValue - a.settledValue ||
      b.total - a.total ||
      a.source.localeCompare(b.source),
  );

  const totals = rows.reduce(
    (t, r) => ({
      open: t.open + r.open,
      settled: t.settled + r.settled,
      total: t.total + r.total,
      settledValue: t.settledValue + r.settledValue,
      openPipelineValue: t.openPipelineValue + r.openPipelineValue,
    }),
    { open: 0, settled: 0, total: 0, settledValue: 0, openPipelineValue: 0 },
  );

  return {
    rows,
    totals,
    unattributed: map.get(UNATTRIBUTED)?.total ?? 0,
    sourceCount: rows.filter((r) => r.source !== UNATTRIBUTED).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Momentum tracker — settled value by source, month over month               */
/* -------------------------------------------------------------------------- */

export interface SourceTrendSeries {
  source: string;
  /** Settled value per month, aligned index-for-index with `months`. */
  monthly: number[];
  /** Settled deal count per month, aligned with `months`. */
  monthlyCount: number[];
  /** Total settled value across the window. */
  total: number;
}

export interface SourceTrend {
  /** Oldest → newest, one entry per month in the window. */
  months: { key: string; label: string }[];
  /** One series per source that settled anything in the window, ranked by total. */
  series: SourceTrendSeries[];
  /** Largest single monthly value across all series, for bar scaling (min 1). */
  max: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Settled value by source over the last `months` calendar months, so the
 * business can see which channels are heating up or cooling off — the
 * "tracker" half of the leaderboard. Only settled deals with a settle date
 * and a lead source contribute; unattributed settlements are excluded so
 * the trend reads cleanly.
 */
export function buildSourceTrend(
  deals: Deal[],
  now: Date,
  months = 6,
): SourceTrend {
  const buckets: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const bySource = new Map<string, SourceTrendSeries>();
  for (const d of deals) {
    if (d.stageId !== "settled" || !d.settledOn) continue;
    const source = (d.leadSource || "").trim();
    if (!source) continue; // unattributed excluded from the trend
    const settled = new Date(d.settledOn);
    if (Number.isNaN(settled.getTime())) continue;
    const key = `${settled.getFullYear()}-${String(settled.getMonth() + 1).padStart(2, "0")}`;
    const i = index.get(key);
    if (i === undefined) continue; // outside the window

    let series = bySource.get(source);
    if (!series) {
      series = {
        source,
        monthly: new Array(buckets.length).fill(0),
        monthlyCount: new Array(buckets.length).fill(0),
        total: 0,
      };
      bySource.set(source, series);
    }
    const value = d.loanAmount ?? 0;
    series.monthly[i] += value;
    series.monthlyCount[i] += 1;
    series.total += value;
  }

  const series = [...bySource.values()].sort(
    (a, b) => b.total - a.total || a.source.localeCompare(b.source),
  );
  const max = Math.max(1, ...series.flatMap((s) => s.monthly));
  return { months: buckets, series, max };
}

/**
 * The best-converting channel above a minimum deal count, so a lone 1-of-1
 * settlement doesn't top the table at 100%. Returns null when no channel
 * clears the floor.
 */
export function bestConvertingSource(
  attribution: SourceAttribution,
  minDeals = 2,
): SourceRow | null {
  const eligible = attribution.rows.filter(
    (r) => r.source !== UNATTRIBUTED && r.total >= minDeals && r.settled > 0,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => (r.settledRate > best.settledRate ? r : best));
}

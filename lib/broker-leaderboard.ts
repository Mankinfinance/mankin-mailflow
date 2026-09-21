import type { Deal } from "./clients/salestrekker/types";
import type { TeamMember } from "./team";

/**
 * Broker leaderboard + momentum — ranks the broking team by the value they
 * actually settle, with conversion and live pipeline alongside. Same shape
 * and honesty as the lead-source leaderboard, pointed at the team instead
 * of the channel. Pure over the deal list + roster, so it works on the
 * mock dataset today and the live Salestrekker feed later without change.
 */

export interface BrokerRow {
  brokerId: string;
  /** Display name (team member's short name). */
  name: string;
  /** Active deals still in flight (non-nurtured, not yet settled). */
  open: number;
  /** Deals that have settled. */
  settled: number;
  /** open + settled — the base for settledRate. */
  total: number;
  settledValue: number;
  openPipelineValue: number;
  avgSettledLoan: number;
  /** settled / total, 0..1. 0 when the broker has no deals. */
  settledRate: number;
}

export interface BrokerLeaderboard {
  /** One row per broker in the roster, ranked by settled value desc. */
  rows: BrokerRow[];
  totals: {
    open: number;
    settled: number;
    total: number;
    settledValue: number;
    openPipelineValue: number;
  };
}

export function buildBrokerLeaderboard(
  deals: Deal[],
  brokers: TeamMember[],
): BrokerLeaderboard {
  const rows: BrokerRow[] = brokers.map((m) => {
    const owned = deals.filter((d) => d.brokerId === m.id);
    let open = 0;
    let settled = 0;
    let settledValue = 0;
    let openPipelineValue = 0;
    for (const d of owned) {
      const isSettled = d.stageId === "settled";
      const isNurtured = d.nurturedAt !== null;
      if (isSettled) {
        settled += 1;
        settledValue += d.loanAmount ?? 0;
      } else if (!isNurtured) {
        open += 1;
        openPipelineValue += d.loanAmount ?? 0;
      }
    }
    const total = open + settled;
    return {
      brokerId: m.id,
      name: m.short,
      open,
      settled,
      total,
      settledValue,
      openPipelineValue,
      avgSettledLoan: settled > 0 ? Math.round(settledValue / settled) : 0,
      settledRate: total > 0 ? settled / total : 0,
    };
  });

  rows.sort(
    (a, b) =>
      b.settledValue - a.settledValue ||
      b.settled - a.settled ||
      a.name.localeCompare(b.name),
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

  return { rows, totals };
}

/* -------------------------------------------------------------------------- */
/* Momentum — settled value by broker, month over month                       */
/* -------------------------------------------------------------------------- */

export interface BrokerTrendSeries {
  brokerId: string;
  name: string;
  monthly: number[];
  monthlyCount: number[];
  total: number;
}

export interface BrokerTrend {
  months: { key: string; label: string }[];
  series: BrokerTrendSeries[];
  max: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function buildBrokerTrend(
  deals: Deal[],
  brokers: TeamMember[],
  now: Date,
  months = 6,
): BrokerTrend {
  const buckets: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const nameById = new Map(brokers.map((m) => [m.id, m.short]));

  const byBroker = new Map<string, BrokerTrendSeries>();
  for (const d of deals) {
    if (d.stageId !== "settled" || !d.settledOn) continue;
    if (!nameById.has(d.brokerId)) continue; // only roster brokers
    const settled = new Date(d.settledOn);
    if (Number.isNaN(settled.getTime())) continue;
    const key = `${settled.getFullYear()}-${String(settled.getMonth() + 1).padStart(2, "0")}`;
    const i = index.get(key);
    if (i === undefined) continue;

    let series = byBroker.get(d.brokerId);
    if (!series) {
      series = {
        brokerId: d.brokerId,
        name: nameById.get(d.brokerId) ?? d.brokerId,
        monthly: new Array(buckets.length).fill(0),
        monthlyCount: new Array(buckets.length).fill(0),
        total: 0,
      };
      byBroker.set(d.brokerId, series);
    }
    const value = d.loanAmount ?? 0;
    series.monthly[i] += value;
    series.monthlyCount[i] += 1;
    series.total += value;
  }

  const series = [...byBroker.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const max = Math.max(1, ...series.flatMap((s) => s.monthly));
  return { months: buckets, series, max };
}

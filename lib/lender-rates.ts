import { lenderById } from "./lenders";

/**
 * Lender rate tracker — the best owner-occupier variable rate each lender
 * is offering at the three LVR bands the team quotes on (≤60%, ≤70%,
 * ≤80%), and which lenders lead each band. Rates move constantly and no
 * feed exists yet, so this is broker-maintained: a seeded baseline that
 * each edit overrides, with every change written to the audit event log so
 * the movement is tracked over time (no new table, same pattern as the
 * milestone queue).
 *
 * Lower LVR means more equity and less risk, so rates get sharper as the
 * band drops. "Best" = lowest rate.
 */

/** LVR bands, best-equity first. */
export const RATE_BANDS = [
  { key: "lvr60", lvr: 60, label: "≤ 60% LVR" },
  { key: "lvr70", lvr: 70, label: "≤ 70% LVR" },
  { key: "lvr80", lvr: 80, label: "≤ 80% LVR" },
] as const;

export type RateBandKey = (typeof RATE_BANDS)[number]["key"];

export interface LenderRateValues {
  lvr60: number | null;
  lvr70: number | null;
  lvr80: number | null;
}

export interface LenderRateRecord extends LenderRateValues {
  lenderId: string;
  lenderName: string;
  /** ISO timestamp of the last edit, or null when still on the seed. */
  updatedAt: string | null;
  updatedBy: string;
}

/** Audit action written when a broker sets a lender's rates. */
export const LENDER_RATE_ACTION = "lender_rate.set";

/**
 * Seeded baseline (indicative owner-occupier P&I variable, %). Realistic
 * spread so the leaderboard is meaningful on day one; every figure is one
 * edit away from the desk's live numbers.
 */
export const LENDER_RATE_SEED: Record<string, LenderRateValues> = {
  macquarie: { lvr60: 5.94, lvr70: 6.04, lvr80: 6.14 },
  ubank: { lvr60: 5.99, lvr70: 6.04, lvr80: 6.09 },
  amp: { lvr60: 6.09, lvr70: 6.19, lvr80: 6.29 },
  bankwest: { lvr60: 6.09, lvr70: 6.19, lvr80: 6.34 },
  ing: { lvr60: 6.04, lvr70: 6.14, lvr80: 6.24 },
  suncorp: { lvr60: 6.1, lvr70: 6.2, lvr80: 6.35 },
  anz: { lvr60: 6.14, lvr70: 6.24, lvr80: 6.44 },
  westpac: { lvr60: 6.14, lvr70: 6.24, lvr80: 6.44 },
  cba: { lvr60: 6.19, lvr70: 6.29, lvr80: 6.49 },
  nab: { lvr60: 6.19, lvr70: 6.29, lvr80: 6.44 },
};

interface RateEvent {
  dealId?: string | null;
  meta: unknown;
  createdAt?: string | Date | null;
  actorId?: string | null;
}

/** Latest rates per lender: seed, then overridden by the newest audit
 *  event for each lender. `events` is newest-first (as the audit repo
 *  returns them). */
export function currentRatesFromEvents(
  events: RateEvent[],
  seed: Record<string, LenderRateValues> = LENDER_RATE_SEED,
): Map<string, LenderRateRecord> {
  const out = new Map<string, LenderRateRecord>();
  for (const [lenderId, v] of Object.entries(seed)) {
    out.set(lenderId, {
      lenderId,
      lenderName: lenderById(lenderId)?.name ?? lenderId,
      ...v,
      updatedAt: null,
      updatedBy: "seed",
    });
  }

  const seen = new Set<string>();
  for (const e of events) {
    const m = e.meta as
      | { lenderId?: string; lvr60?: number | null; lvr70?: number | null; lvr80?: number | null }
      | null;
    const lenderId = m?.lenderId;
    if (!lenderId || seen.has(lenderId)) continue; // newest wins
    seen.add(lenderId);
    out.set(lenderId, {
      lenderId,
      lenderName: lenderById(lenderId)?.name ?? lenderId,
      lvr60: m.lvr60 ?? null,
      lvr70: m.lvr70 ?? null,
      lvr80: m.lvr80 ?? null,
      updatedAt:
        e.createdAt instanceof Date
          ? e.createdAt.toISOString()
          : (e.createdAt ?? null),
      updatedBy: e.actorId ?? "broker",
    });
  }
  return out;
}

export interface BandLeader {
  rank: number;
  lenderId: string;
  lenderName: string;
  rate: number;
}

/** The lowest-rate lenders for a band, best first. */
export function topLendersForBand(
  current: Map<string, LenderRateRecord>,
  band: RateBandKey,
  n = 3,
): BandLeader[] {
  return [...current.values()]
    .map((r) => ({ lenderId: r.lenderId, lenderName: r.lenderName, rate: r[band] }))
    .filter((r): r is { lenderId: string; lenderName: string; rate: number } => r.rate !== null)
    .sort((a, b) => a.rate - b.rate || a.lenderName.localeCompare(b.lenderName))
    .slice(0, n)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

/** The most recent rate edit across all lenders, or null on pure seed. */
export function lastRateUpdate(
  current: Map<string, LenderRateRecord>,
): { at: string; lenderName: string; by: string } | null {
  let latest: { at: string; lenderName: string; by: string } | null = null;
  for (const r of current.values()) {
    if (!r.updatedAt) continue;
    if (!latest || r.updatedAt > latest.at) {
      latest = { at: r.updatedAt, lenderName: r.lenderName, by: r.updatedBy };
    }
  }
  return latest;
}

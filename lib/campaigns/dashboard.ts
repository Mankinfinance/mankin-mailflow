import type { CampaignRow, CampaignRecipientRow } from "@/lib/db/schema";

/**
 * The numbers behind the Mailflow dashboard.
 *
 * Pure functions over rows the caller has already fetched, so the shapes
 * the dashboard depends on — a flat contact series, a month table, a
 * spam-complaint rate — are unit-testable without a database.
 *
 * One judgement runs through all of it: a brokerage sends twice a month
 * and imports contacts in monthly batches, so most days are genuinely
 * zero and most series are genuinely flat. Nothing here may turn that
 * ordinariness into alarm.
 */

export interface MonthRow {
  /** "Aug 2026" */
  label: string;
  /** yyyy-mm, for sorting and keys. */
  key: string;
  campaigns: number;
  emailsSent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  /** Complaints as a share of emails sent, 0–1. Null when nothing was
   *  sent that month — a rate over zero sends is not zero, it is absent. */
  complaintRate: number | null;
}

/**
 * The threshold at which a sending domain is at risk. Both Microsoft and
 * Google act well below 0.3%; 0.1% is the number to hold ourselves to.
 */
export const COMPLAINT_THRESHOLD = 0.001;

export function isComplaintRateAtRisk(rate: number | null): boolean {
  return rate !== null && rate >= COMPLAINT_THRESHOLD;
}

/**
 * Campaign performance by month sent, newest first.
 *
 * Spam complaints are not something Graph reports back to us, so the
 * column is present and honest: the rate is null until a feedback loop
 * exists to populate it, rather than showing a fabricated 0.00% that
 * would read as "we checked and it is fine".
 */
export function buildMonthRows(
  campaigns: CampaignRow[],
  recipientsByCampaign: Map<string, CampaignRecipientRow[]>,
  opts: { months?: number; now?: Date } = {},
): MonthRow[] {
  const months = opts.months ?? 6;
  const now = opts.now ?? new Date();

  const buckets = new Map<string, MonthRow>();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      key,
      label: d.toLocaleDateString("en-AU", { month: "short", year: "numeric" }),
      campaigns: 0,
      emailsSent: 0,
      opened: 0,
      clicked: 0,
      unsubscribed: 0,
      complaintRate: null,
    });
  }

  for (const campaign of campaigns) {
    const sentAt = campaign.startedAt;
    if (!sentAt) continue;
    const key = `${sentAt.getFullYear()}-${String(sentAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;

    bucket.campaigns += 1;
    for (const r of recipientsByCampaign.get(campaign.id) ?? []) {
      if (r.status !== "sent") continue;
      bucket.emailsSent += 1;
      if (r.openedAt) bucket.opened += 1;
      if (r.clickedAt) bucket.clicked += 1;
      if (r.unsubscribedAt) bucket.unsubscribed += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export interface ContactPoint {
  /** ISO yyyy-mm-dd. */
  date: string;
  contacts: number;
}

export interface ContactSeries {
  points: ContactPoint[];
  /** Axis bounds, held to a minimum window so ordinary movement stays
   *  ordinary — see holdAxis below. */
  min: number;
  max: number;
  /** The typical band, for the chip and the shaded region. */
  typicalLow: number;
  typicalHigh: number;
}

/**
 * The y-domain rule that keeps the growth chart honest.
 *
 * An auto-scaled axis over a series that moves by two contacts turns a
 * routine unsubscribe into a cliff — which is exactly what the tool this
 * replaces did. Holding a minimum window of `minSpan` means a two-contact
 * dip renders as a two-contact dip.
 */
export function holdAxis(
  values: number[],
  minSpan = 10,
): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: minSpan };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  if (span >= minSpan) {
    // Real movement — pad slightly so the line isn't welded to the edge.
    const pad = Math.ceil(span * 0.15);
    return { min: lo - pad, max: hi + pad };
  }
  // Centre the flat series inside the held window.
  const slack = minSpan - span;
  const below = Math.floor(slack / 2);
  return { min: lo - below, max: lo - below + minSpan };
}

/**
 * Daily contactable-audience size over a window, walked backwards from
 * today's figure using the opt-outs we know about.
 *
 * The back-book only tells us its size now, not its size on 3 August, so
 * the series is reconstructed rather than recorded: start from today and
 * add back each suppression as you walk back past its date. That is
 * exact for the movement we cause and blind to imports, which is why the
 * card says imports arrive in batches rather than pretending the line
 * captures them.
 */
export function buildContactSeries(
  currentContacts: number,
  suppressedDates: Date[],
  opts: { days?: number; now?: Date } = {},
): ContactSeries {
  const days = opts.days ?? 30;
  const now = opts.now ?? new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const optOutsByDay = new Map<string, number>();
  for (const d of suppressedDates) {
    const key = isoDay(d);
    optOutsByDay.set(key, (optOutsByDay.get(key) ?? 0) + 1);
  }

  const points: ContactPoint[] = [];
  let running = currentContacts;
  for (let i = 0; i < days; i++) {
    const day = new Date(startOfToday);
    day.setDate(day.getDate() - i);
    const key = isoDay(day);
    points.unshift({ date: key, contacts: running });
    // Walking further back: whoever opted out on this day was still a
    // contact the day before.
    running += optOutsByDay.get(key) ?? 0;
  }

  const values = points.map((p) => p.contacts);
  const { min, max } = holdAxis(values);
  return {
    points,
    min,
    max,
    typicalLow: Math.min(...values),
    typicalHigh: Math.max(...values),
  };
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Count of suppressions inside a trailing window. */
export function countSince(dates: Date[], since: Date): number {
  return dates.filter((d) => d >= since).length;
}

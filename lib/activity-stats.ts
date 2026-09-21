import "server-only";
import { repos } from "@/lib/db/repos";
import { TEAM } from "@/lib/team";

/**
 * Per-team-member communication counts — how many emails and SMS each
 * broker has actually sent, for today / this week / this month. Built from
 * audit_log (every real send records the broker who did it). Powers the
 * Michael-only Team activity view.
 *
 * We count the actual send events, not drafts, and skip system/cron sends
 * (portal reminders etc.) so the numbers reflect what a person did.
 */

// Real customer email sends. Note: composer email produces both a
// note-only "dashboard.composer.send.email" row and the actual
// "dashboard.outlook.send" row — we count only the latter so it isn't
// double-counted. eod sends also flow through outlook.send.
const EMAIL_ACTIONS = [
  "dashboard.outlook.send",
  "dashboard.deal.create.email.sent",
  "cx.review.send",
];
const SMS_ACTIONS = ["dashboard.composer.send.sms"];

export interface PeriodCounts {
  today: number;
  week: number;
  month: number;
}

export interface MemberActivity {
  id: string;
  name: string;
  short: string;
  role: string;
  email: PeriodCounts;
  sms: PeriodCounts;
  total: PeriodCounts;
}

export interface ActivityStats {
  generatedAt: string;
  rows: MemberActivity[];
  totals: { email: PeriodCounts; sms: PeriodCounts; total: PeriodCounts };
}

const zero = (): PeriodCounts => ({ today: 0, week: 0, month: 0 });

/** AU calendar date, "YYYY-MM-DD". */
function auDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export async function getActivityStats(
  now: Date = new Date(),
): Promise<ActivityStats> {
  const audit = repos().audit;

  const todayKey = auDateKey(now);
  const monthKey = todayKey.slice(0, 7);
  const monthStartKey = `${monthKey}-01`;
  const auWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Sydney",
    weekday: "long",
  }).format(now);
  const daysSinceMonday = (WEEKDAYS.indexOf(auWeekday) + 6) % 7;
  const mondayKey = auDateKey(new Date(now.getTime() - daysSinceMonday * 86_400_000));
  // Earliest date any bucket cares about. At the start of a month the
  // current week reaches back into last month, so the lower bound is the
  // earlier of "this Monday" and "the 1st" — otherwise those late-last-month
  // days would be dropped and the week count would be short.
  const earliestKey = mondayKey < monthStartKey ? mondayKey : monthStartKey;

  const acc = new Map<string, { email: PeriodCounts; sms: PeriodCounts }>();
  const ensure = (id: string) => {
    let v = acc.get(id);
    if (!v) {
      v = { email: zero(), sms: zero() };
      acc.set(id, v);
    }
    return v;
  };

  async function tally(actions: string[], bucket: "email" | "sms"): Promise<void> {
    for (const action of actions) {
      const rows = await audit.list({ action, limit: 5000 });
      for (const r of rows) {
        if (r.actorType !== "broker") continue;
        const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
        const key = auDateKey(created);
        if (key < earliestKey) continue; // older than both this week and this month
        const c = ensure(r.actorId)[bucket];
        if (key.slice(0, 7) === monthKey) c.month += 1;
        if (key >= mondayKey) c.week += 1;
        if (key === todayKey) c.today += 1;
      }
    }
  }

  await tally(EMAIL_ACTIONS, "email");
  await tally(SMS_ACTIONS, "sms");

  const rows: MemberActivity[] = TEAM.filter((m) => m.id !== "ceo").map((m) => {
    const a = acc.get(m.id) ?? { email: zero(), sms: zero() };
    const total: PeriodCounts = {
      today: a.email.today + a.sms.today,
      week: a.email.week + a.sms.week,
      month: a.email.month + a.sms.month,
    };
    return {
      id: m.id,
      name: m.name,
      short: m.short,
      role: m.role,
      email: a.email,
      sms: a.sms,
      total,
    };
  });
  rows.sort((x, y) => y.total.month - x.total.month);

  const sum = (pick: (r: MemberActivity) => PeriodCounts): PeriodCounts =>
    rows.reduce(
      (t, r) => {
        const p = pick(r);
        return { today: t.today + p.today, week: t.week + p.week, month: t.month + p.month };
      },
      zero(),
    );

  return {
    generatedAt: now.toISOString(),
    rows,
    totals: {
      email: sum((r) => r.email),
      sms: sum((r) => r.sms),
      total: sum((r) => r.total),
    },
  };
}

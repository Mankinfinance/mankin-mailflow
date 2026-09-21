import Link from "next/link";
import { ArrowRight, History } from "lucide-react";
import {
  MailflowNav,
  SendingDomainHealth,
} from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
  StatGrid,
  StatTile,
} from "@/components/mailflow/MailflowPage";
import { ContactGrowthChart } from "@/components/mailflow/ContactGrowthChart";
import { currentBroker } from "@/lib/auth/current-broker";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { repos } from "@/lib/db/repos";
import { teamMember } from "@/lib/team";
import {
  buildContactSeries,
  buildMonthRows,
  countSince,
  isComplaintRateAtRisk,
  type MonthRow,
} from "@/lib/campaigns/dashboard";
import {
  buildAutomationOverview,
  buildFormOverview,
} from "@/lib/mailflow/overview";
import {
  buildSendingHealth,
  describeBand,
  type HealthBand,
  type HealthMetric,
} from "@/lib/mailflow/sending-health";

export const metadata = { title: "Mailflow · Mankin Finance" };

/**
 * Screen 1 — the overview. Answers "did the last send work" and "is
 * anything wrong with our sending" without being asked.
 *
 * The zero-state treatment is the considered part. A brokerage adds
 * contacts in monthly batches and sends twice a month, so most days are
 * genuinely zero and the growth line is genuinely flat. Every zero here
 * is paired with the reason it is expected, and the chart's axis is held
 * open so ordinary movement stays ordinary. Nothing may read as broken.
 */
export default async function MailflowDashboard() {
  const broker = await currentBroker();

  const [campaigns, suppressions, settlements, deals, automations, forms] =
    await Promise.all([
      repos().campaign.list(),
      repos().campaign.listSuppressions(2000),
      listSettlements(),
      getSalestrekkerClient().listDeals(),
      repos().automation.list(),
      repos().form.list(),
    ]);

  const recipientsByCampaign = new Map(
    await Promise.all(
      campaigns.map(
        async (c) =>
          [c.id, await repos().campaign.listRecipients(c.id, { limit: 5000 })] as const,
      ),
    ),
  );

  /* Contactable audience: everyone the book could reach today, less
     anyone on the register. Matches what an audience actually resolves
     to, so the headline number is not larger than any campaign can be. */
  const suppressedSet = new Set(suppressions.map((s) => s.email));
  const contactable = new Set<string>();
  for (const s of settlements) {
    const email = s.email.trim().toLowerCase();
    if (email && !suppressedSet.has(email)) contactable.add(email);
  }
  for (const d of deals) {
    const email = d.email.trim().toLowerCase();
    if (email && !suppressedSet.has(email)) contactable.add(email);
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(startOfToday);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const suppressedDates = suppressions.map((s) => s.createdAt);
  const series = buildContactSeries(contactable.size, suppressedDates, { now });
  const monthRows = buildMonthRows(campaigns, recipientsByCampaign, { now });

  const sentCampaigns = campaigns
    .filter((c) => c.startedAt !== null)
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
  const last = sentCampaigns[0];
  const lastStats = last ? await repos().campaign.stats(last.id) : null;

  const thisMonth = monthRows[0];

  /* The other two modules, rolled up over the same 30-day window as
     everything else on this page. Both are cheap: a brokerage has a
     handful of sequences and forms, not thousands. */
  const automationRuns = (
    await Promise.all(
      automations.map((a) =>
        repos().automation.listRuns(a.id, { limit: 5000 }),
      ),
    )
  ).flat();
  const automationSends = (
    await Promise.all(
      automationRuns.map((r) => repos().automation.latestSendForRun(r.id)),
    )
  ).filter((s): s is NonNullable<typeof s> => s !== null);
  const formSubmissions = (
    await Promise.all(
      forms.map((f) => repos().form.listSubmissions(f.id, 5000)),
    )
  ).flat();

  /* Sending health off our own data. The recipient-side complaint rate
     is not obtainable on shared Exchange infrastructure (see the note in
     lib/mailflow/sending-health.ts), so this is the pair of leading
     indicators we do own. */
  const allRecipients = (
    await Promise.all(
      campaigns.map((c) =>
        repos().campaign.listRecipients(c.id, { limit: 5000 }),
      ),
    )
  ).flat();
  const health = buildSendingHealth({
    recipients: allRecipients,
    suppressions,
    since: thirtyDaysAgo,
  });

  const automationOverview = buildAutomationOverview({
    automations,
    runs: automationRuns,
    sends: automationSends,
    since: thirtyDaysAgo,
  });
  const formOverview = buildFormOverview({
    forms,
    submissions: formSubmissions,
    since: thirtyDaysAgo,
  });

  return (
    <>
      <MailflowNav
        active="dashboard"
        footer={
          <SendingDomainHealth domain="mankinfinance.com" authenticated />
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
          createHref="/marketing/campaigns"
          createLabel="Create"
        />
        <MailflowContent>
          <PageTitle
            title="Dashboard"
            context={`${contactable.size} contactable · ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · ${suppressions.length} on the register`}
          />

          {/* ── Last sent campaign ── */}
          {last && lastStats ? (
            <Card className="mb-[22px]" padded={false}>
              <div className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <h2
                    className="text-[18px] text-brand-deep"
                    style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
                  >
                    {last.name}
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-mute">
                    Sent{" "}
                    {last.startedAt?.toLocaleString("en-AU", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {teamMember(last.fromBrokerId).name}
                  </p>
                  <p className="mono mt-1 truncate text-[11px] text-ink-mute">
                    {last.subject}
                  </p>
                </div>
                <Link
                  href={`/marketing/campaigns/${last.id}`}
                  className="mf-quiet flex h-[31px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 text-[12px] font-semibold text-brand transition-colors hover:bg-paper-warm"
                >
                  View report
                  <ArrowRight size={13} strokeWidth={1.5} />
                </Link>
              </div>
              <div className="px-4 pb-4">
                <StatGrid>
                  <StatTile label="Recipients" value={String(lastStats.sent)} />
                  <StatTile
                    label="Opened"
                    value={rate(lastStats.opened, lastStats.sent)}
                    suffix="%"
                  />
                  <StatTile
                    label="Clicked"
                    value={rate(lastStats.clicked, lastStats.sent)}
                    suffix="%"
                  />
                  <StatTile
                    label="Click to open"
                    value={rate(lastStats.clicked, lastStats.opened)}
                    suffix="%"
                  />
                </StatGrid>
              </div>
            </Card>
          ) : (
            <Card className="mb-[22px]">
              <Eyebrow>Last sent campaign</Eyebrow>
              <p className="mt-1.5 text-[12.5px] text-ink-mute">
                Nothing has been sent yet. The first campaign you send will
                summarise itself here.
              </p>
            </Card>
          )}

          {/* ── Performance overview ── */}
          <div className="mb-[9px] flex items-end justify-between border-b border-hairline pb-2">
            <Eyebrow>Performance overview</Eyebrow>
            <span className="text-[11px] text-ink-mute">Last 30 days</span>
          </div>

          <div className="mb-[22px] flex flex-wrap gap-3.5 pt-3">
            {/* Subscribers block */}
            <Card className="w-[322px] shrink-0">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[40px] leading-none tabular-nums text-brand-deep"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
                >
                  {contactable.size}
                </span>
                <span className="text-[11.5px] text-ink-mute">active contacts</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
                Contacts arrive in monthly batches from the aggregator file.
                Nothing is expected between imports.
              </p>
              <div className="mt-3 space-y-px">
                <ZeroRow
                  label="New today"
                  value={0}
                  reason="none expected"
                />
                <ZeroRow
                  label="New this month"
                  value={0}
                  reason="next import at month end"
                />
                <ZeroRow
                  label="Opted out, 30 days"
                  value={countSince(suppressedDates, thirtyDaysAgo)}
                  reason="honoured immediately"
                />
              </div>
              <p className="mt-3 flex items-center gap-1.5 border-t border-hairline pt-2.5 text-[10.5px] text-ink-mute">
                <History size={12} strokeWidth={1.5} />
                {settlements.length} settled loans in the book
              </p>
            </Card>

            {/* Growth chart */}
            <Card className="min-w-[420px] flex-1">
              <div className="mb-1 flex items-start justify-between gap-4">
                <div>
                  <Eyebrow>Active contacts, last 30 days</Eyebrow>
                  <p className="mt-1 text-[11px] text-ink-mute">
                    Flat by design. The axis is held to a 10-contact window so
                    ordinary movement stays ordinary.
                  </p>
                </div>
                <span
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] text-ink-mute"
                  style={{ backgroundColor: "var(--color-paper-warm)" }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#eaeefe" }}
                  />
                  Typical range {series.typicalLow}–{series.typicalHigh}
                </span>
              </div>
              <ContactGrowthChart series={series} />
            </Card>
          </div>

          {/* ── Campaign engagement ── */}
          <Card className="mb-[22px]" padded={false}>
            <div className="px-4 pt-3.5">
              <Eyebrow>Campaign engagement, this month</Eyebrow>
            </div>
            <div className="px-4 pb-4 pt-2.5">
              <StatGrid>
                <StatTile
                  label="Emails sent"
                  value={thisMonth.emailsSent.toLocaleString("en-AU")}
                />
                <StatTile
                  label="Opens"
                  value={String(thisMonth.opened)}
                  tone="var(--color-series-1)"
                />
                <StatTile
                  label="Clicks"
                  value={String(thisMonth.clicked)}
                  tone="var(--color-series-2)"
                />
                <StatTile
                  label="Click to open"
                  value={rate(thisMonth.clicked, thisMonth.opened)}
                  suffix="%"
                />
              </StatGrid>
            </div>
          </Card>

          {/* ── Sending health ── */}
          <Card className="mb-[22px]">
            <div className="mb-2.5 flex items-start justify-between gap-4">
              <div>
                <Eyebrow>Sending health, last 30 days</Eyebrow>
                <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-ink-mute">
                  The two signals that move before a sending domain gets into
                  trouble. Complaint rate is not shown because it is not
                  obtainable on shared Exchange infrastructure.
                </p>
              </div>
              <HealthBadge band={health.overall} />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <HealthCard
                label="Opted out"
                metric={health.unsubscribe}
                note={describeBand(
                  health.unsubscribe.band,
                  "unsubscribe",
                  health.unsubscribe.denominator,
                )}
                denominatorLabel="of mail delivered"
              />
              <HealthCard
                label="Bounced"
                metric={health.bounce}
                note={describeBand(
                  health.bounce.band,
                  "bounce",
                  health.bounce.denominator,
                )}
                denominatorLabel="of mail attempted"
              />
            </div>
          </Card>

          {/* ── Automations ── */}
          <Card className="mb-[22px]" padded={false}>
            <div className="flex items-baseline justify-between gap-4 px-4 pt-3.5">
              <div>
                <Eyebrow>Automations</Eyebrow>
                <p className="mt-1 text-[11px] text-ink-mute">
                  Sequences that send without anyone pressing send.
                </p>
              </div>
              <Link
                href="/marketing/automations"
                className="text-[11.5px] font-semibold text-brand hover:underline"
              >
                {automationOverview.live} live
              </Link>
            </div>
            <div className="px-4 pb-4 pt-2.5">
              <StatGrid>
                <StatTile
                  label="In progress"
                  value={String(automationOverview.inProgress)}
                  note="partway through a sequence"
                />
                <StatTile
                  label="Completed"
                  value={String(automationOverview.completed)}
                  note="reached the end"
                />
                <StatTile
                  label="Emails sent"
                  value={String(automationOverview.sentInWindow)}
                  note="last 30 days"
                />
                <StatTile
                  label="Opted out"
                  value={String(automationOverview.unsubscribedInWindow)}
                  note="during a sequence"
                />
              </StatGrid>
            </div>
          </Card>

          {/* ── Forms ── */}
          <Card className="mb-[22px]" padded={false}>
            <div className="flex items-baseline justify-between gap-4 px-4 pt-3.5">
              <div>
                <Eyebrow>Forms</Eyebrow>
                <p className="mt-1 text-[11px] text-ink-mute">
                  Enquiries from the website, straight into the pipeline.
                </p>
              </div>
              <Link
                href="/marketing/forms"
                className="text-[11.5px] font-semibold text-brand hover:underline"
              >
                {formOverview.live} live
              </Link>
            </div>
            <div className="px-4 pb-4 pt-2.5">
              <StatGrid columns={3}>
                <StatTile
                  label="Enquiries"
                  value={String(formOverview.submissionsInWindow)}
                  note="last 30 days"
                />
                <StatTile
                  label="Became deals"
                  value={String(formOverview.becameDeals)}
                  note="in the pipeline"
                />
                <StatTile
                  label="Conversion"
                  value={
                    formOverview.conversionRate === null
                      ? "—"
                      : formOverview.conversionRate.toFixed(1)
                  }
                  suffix={formOverview.conversionRate === null ? undefined : "%"}
                  note="of everyone who saw a form"
                />
              </StatGrid>
            </div>
          </Card>

          {/* ── Performance by month ── */}
          <Card padded={false} className="overflow-hidden">
            <div className="px-4 pt-3.5">
              <Eyebrow>Campaign performance by month sent</Eyebrow>
              <p className="mt-1 text-[11px] text-ink-mute">
                Spam complaints above 0.10% put the sending domain at risk. The
                column stays unmeasured until a feedback loop is connected — see
                sending health above for the signals we do have.
              </p>
            </div>
            <table className="mt-3 w-full">
              <thead>
                <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                  <Th>Month</Th>
                  <Th align="right">Campaigns</Th>
                  <Th align="right">Emails sent</Th>
                  <Th align="right">Opened</Th>
                  <Th align="right">Clicked</Th>
                  <Th align="right">Unsubscribed</Th>
                  <Th align="right" spam>
                    Spam complaints
                  </Th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((row) => (
                  <MonthTableRow key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </Card>
        </MailflowContent>
      </div>
    </>
  );
}

function rate(part: number, whole: number): string {
  if (!whole) return "0.0";
  return ((part / whole) * 100).toFixed(1);
}

/** A zero paired with the reason it is expected. A brokerage genuinely
 *  has zero most days; nothing here should read as needing action. */
function ZeroRow({
  label,
  value,
  reason,
}: {
  label: string;
  value: number;
  reason: string;
}) {
  const isZero = value === 0;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11.5px] text-ink-soft">{label}</span>
      <span className="flex items-baseline gap-2">
        <span
          className="text-[10.5px]"
          style={{ color: "var(--color-ink-annotation)" }}
        >
          {reason}
        </span>
        <span
          className="text-[19px] font-semibold leading-none tabular-nums"
          style={{
            color: isZero ? "var(--color-ink-zero)" : "var(--color-ink)",
          }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function MonthTableRow({ row }: { row: MonthRow }) {
  const atRisk = isComplaintRateAtRisk(row.complaintRate);
  return (
    <tr className="border-t" style={{ borderColor: "var(--color-hairline-softer)" }}>
      <td className="px-3.5 py-2 text-[12px] text-ink-soft">{row.label}</td>
      <Td>{row.campaigns}</Td>
      <Td>{row.emailsSent.toLocaleString("en-AU")}</Td>
      <Td>{row.opened}</Td>
      <Td>{row.clicked}</Td>
      <Td>{row.unsubscribed}</Td>
      <td
        className="px-3.5 py-2 text-right"
        style={{
          backgroundColor: "#fdfbf6",
          borderLeft: "1px solid #f0ece2",
        }}
      >
        {row.complaintRate === null ? (
          <span
            className="text-[11px]"
            title="No feedback loop is connected, so this is unknown rather than zero"
            style={{ color: "var(--color-ink-annotation)" }}
          >
            not measured
          </span>
        ) : atRisk ? (
          <span
            className="inline-flex rounded-md border px-1.5 py-0.5 text-[12px] font-bold tabular-nums"
            style={{
              backgroundColor: "#fbf1e2",
              borderColor: "#e5d3ab",
              color: "#8a6a22",
            }}
          >
            {(row.complaintRate * 100).toFixed(2)}%
          </span>
        ) : (
          <span className="text-[13px] font-bold tabular-nums text-ink-soft">
            {(row.complaintRate * 100).toFixed(2)}%
          </span>
        )}
      </td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
  spam,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  spam?: boolean;
}) {
  return (
    <th
      className={`px-3.5 py-2 text-[10.5px] font-bold uppercase ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{
        letterSpacing: "0.12em",
        color: spam ? "#4a4030" : "var(--color-ink-faint)",
        backgroundColor: spam ? "#efe7d6" : undefined,
        borderLeft: spam ? "1px solid #e2d7c0" : undefined,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3.5 py-2 text-right text-[12px] tabular-nums text-ink-soft">
      {children}
    </td>
  );
}

/** Overall verdict, in a word. */
function HealthBadge({ band }: { band: HealthBand }) {
  const tone =
    band === "act"
      ? { bg: "#fbf0ef", ink: "#a3423e", line: "#eccfcd", label: "Needs attention" }
      : band === "watch"
        ? { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd", label: "Worth watching" }
        : { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4", label: "Healthy" };
  return (
    <span
      className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.ink, borderColor: tone.line }}
    >
      {tone.label}
    </span>
  );
}

function HealthCard({
  label,
  metric,
  note,
  denominatorLabel,
}: {
  label: string;
  metric: HealthMetric;
  note: string;
  denominatorLabel: string;
}) {
  const ink =
    metric.band === "act"
      ? "#a3423e"
      : metric.band === "watch"
        ? "#8a6a22"
        : "var(--color-ink)";

  return (
    <div
      className="rounded-lg border border-hairline px-3.5 py-3"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="text-[24px] font-semibold leading-none tabular-nums"
          style={{
            color: metric.rate === null ? "var(--color-ink-zero)" : ink,
          }}
        >
          {metric.rate === null ? "—" : `${(metric.rate * 100).toFixed(2)}%`}
        </span>
        <span className="text-[11px] text-ink-mute">
          {metric.numerator} {denominatorLabel.replace("of mail", "of")}{" "}
          {metric.denominator}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">{note}</p>
    </div>
  );
}

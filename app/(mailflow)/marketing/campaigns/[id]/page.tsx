import { notFound } from "next/navigation";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import { MailflowEditor } from "@/components/mailflow/MailflowEditor";
import { CampaignReport } from "@/components/mailflow/CampaignReport";
import { FollowUpButton } from "@/components/mailflow/FollowUpButton";
import { CampaignControls } from "@/components/campaigns/CampaignControls";
import type { CurvePoint } from "@/components/mailflow/EngagementCurve";
import { currentBroker } from "@/lib/auth/current-broker";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { repos } from "@/lib/db/repos";
import { TEAM, teamMember } from "@/lib/team";
import { STAGES } from "@/lib/clients/salestrekker/types";
import { AudienceFilterSchema, isEditable } from "@/lib/campaigns/types";
import type { CampaignStatus } from "@/lib/campaigns/types";
import { previewAudienceAction } from "@/app/(mailflow)/marketing/campaigns/actions";

export const metadata = { title: "Campaign · Mailflow" };

export default async function MarketingCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broker = await currentBroker();

  const campaign = await repos().campaign.get(id);
  if (!campaign) notFound();

  const audience = AudienceFilterSchema.parse(campaign.audience);
  const editable = isEditable(campaign.status as CampaignStatus);

  const [stats, settlements, deals, allTags, segmentRows] = await Promise.all([
    repos().campaign.stats(campaign.id),
    listSettlements(),
    getSalestrekkerClient().listDeals(),
    repos().contactTag.counts(),
    repos().segment.list(),
  ]);

  /* A segment whose stored filter no longer parses is dropped rather
     than offered: applying it would silently reset the audience. */
  const segments = segmentRows.flatMap((row) => {
    const parsed = AudienceFilterSchema.safeParse(row.filter);
    if (!parsed.success) return [];
    return [
      {
        id: row.id,
        name: row.name,
        description: row.description,
        filter: parsed.data,
      },
    ];
  });

  const senders = TEAM.filter((m) => m.email).map((m) => ({
    id: m.id,
    name: m.name,
    short: m.short,
    initials: m.initials,
  }));

  if (editable) {
    const lenderCodes = [
      ...new Set(settlements.map((s) => s.lenderCode).filter(Boolean)),
    ].sort();
    // A real count on first paint, so the rail never opens on a zero that
    // then jumps once the client-side recount lands.
    const initial = await previewAudienceAction(audience);

    return (
      <Shell
        broker={broker}
        campaign={campaign}
        title={campaign.name}
        context={`Draft · last saved ${campaign.updatedAt.toLocaleString("en-AU")}`}
      >
        <MailflowEditor
          campaign={{
            id: campaign.id,
            name: campaign.name,
            subject: campaign.subject,
            subjectB: campaign.subjectB ?? "",
            abTestPercent: campaign.abTestPercent,
            body: campaign.body,
            fromBrokerId: campaign.fromBrokerId,
            audience,
            trackOpens: campaign.trackOpens,
            trackClicks: campaign.trackClicks,
          }}
          brokers={senders}
          lenderCodes={lenderCodes}
          stages={STAGES.map((s) => ({ id: s.id, label: s.shortLabel }))}
          allTags={allTags}
          segments={segments}
          sourceCounts={{
            settlements: settlements.filter((s) => s.loanStatus === "active").length,
            deals: deals.filter((d) => d.nurturedAt === null).length,
          }}
          initialPreview={initial.ok ? initial.preview : null}
        />
      </Shell>
    );
  }

  const [recipients, links] = await Promise.all([
    repos().campaign.listRecipients(campaign.id, { limit: 5000 }),
    repos().campaign.linkClicks(campaign.id),
  ]);

  const curve = buildCurve(recipients, campaign.startedAt);
  const problems = recipients.filter(
    (r) => r.status === "failed" || r.status === "skipped",
  );
  const hoursSinceSend = campaign.startedAt
    ? (Date.now() - campaign.startedAt.getTime()) / 3_600_000
    : null;

  const sentLine = campaign.startedAt
    ? `Sent ${campaign.startedAt.toLocaleString("en-AU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })} by ${teamMember(campaign.fromBrokerId).name}`
    : `Queued by ${teamMember(campaign.fromBrokerId).name}`;

  return (
    <Shell
      broker={broker}
      campaign={campaign}
      title={campaign.name}
      context={`${sentLine} · ${audienceSummary(audience)}`}
    >
      <CampaignReport
        stats={stats}
        curve={curve}
        links={links}
        problems={problems}
        hoursSinceSend={hoursSinceSend}
      />
      <div className="mt-3.5">
        <FollowUpButton
          campaignId={campaign.id}
          unopened={Math.max(0, stats.sent - stats.opened)}
        />
      </div>
    </Shell>
  );
}

function Shell({
  broker,
  campaign,
  title,
  context,
  children,
}: {
  broker: { name: string; initials: string; id: string };
  campaign: { id: string; name: string; status: string };
  title: string;
  context: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <MailflowNav active="campaigns" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
          record={{
            name: campaign.name,
            status: campaign.status,
            backHref: "/marketing/campaigns",
          }}
        />
        <MailflowContent>
          <PageTitle
            title={title}
            context={context}
            actions={<CampaignControls id={campaign.id} status={campaign.status} />}
          />
          {children}
        </MailflowContent>
      </div>
    </>
  );
}

/**
 * Cumulative opens and clicks, bucketed by hour since the send started.
 * Recipients carry only the moment each thing happened, so the curve is
 * derived here rather than stored — one pass, and it stays correct if a
 * late open arrives.
 */
function buildCurve(
  recipients: Array<{ openedAt: Date | null; clickedAt: Date | null }>,
  startedAt: Date | null,
): CurvePoint[] {
  if (!startedAt) return [];
  const start = startedAt.getTime();

  const opensByHour = new Array(73).fill(0);
  const clicksByHour = new Array(73).fill(0);
  const bucket = (at: Date) =>
    Math.max(0, Math.min(72, Math.floor((at.getTime() - start) / 3_600_000)));

  for (const r of recipients) {
    if (r.openedAt) opensByHour[bucket(r.openedAt)] += 1;
    if (r.clickedAt) clicksByHour[bucket(r.clickedAt)] += 1;
  }

  const points: CurvePoint[] = [];
  let opens = 0;
  let clicks = 0;
  const elapsed = Math.min(72, Math.floor((Date.now() - start) / 3_600_000));
  for (let hour = 0; hour <= Math.max(1, elapsed); hour++) {
    opens += opensByHour[hour];
    clicks += clicksByHour[hour];
    points.push({ hour, opens, clicks });
  }
  return points;
}

/** "ANZ and CBA, settled Mar 2022 to Jun 2023" — the segment in a phrase,
 *  so a report is readable without opening the filter. */
function audienceSummary(audience: {
  lenderCodes: string[];
  settledFrom: string | null;
  settledTo: string | null;
  sources: string[];
}): string {
  const parts: string[] = [];
  if (audience.lenderCodes.length) {
    const lenders = audience.lenderCodes;
    parts.push(
      lenders.length === 1
        ? lenders[0]
        : `${lenders.slice(0, -1).join(", ")} and ${lenders[lenders.length - 1]}`,
    );
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
  if (audience.settledFrom && audience.settledTo) {
    parts.push(`settled ${fmt(audience.settledFrom)} to ${fmt(audience.settledTo)}`);
  } else if (audience.settledFrom) {
    parts.push(`settled from ${fmt(audience.settledFrom)}`);
  } else if (audience.settledTo) {
    parts.push(`settled to ${fmt(audience.settledTo)}`);
  }
  if (parts.length === 0) {
    parts.push(
      audience.sources.includes("settlements") && audience.sources.includes("deals")
        ? "the back-book and the live pipeline"
        : audience.sources.includes("deals")
          ? "the live pipeline"
          : "the back-book",
    );
  }
  return parts.join(", ");
}

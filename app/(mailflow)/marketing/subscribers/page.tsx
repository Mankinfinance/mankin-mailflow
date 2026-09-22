import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle, Eyebrow } from "@/components/mailflow/MailflowPage";
import { SubscriberTable } from "@/components/mailflow/SubscriberTable";
import { currentBroker } from "@/lib/auth/current-broker";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { repos } from "@/lib/db/repos";
import { TEAM } from "@/lib/team";
import { STAGES } from "@/lib/clients/salestrekker/types";
import {
  buildActivity,
  buildSubscribers,
  countSubscribers,
  type ActivityEvent,
} from "@/lib/campaigns/subscribers";
import {
  bestSendHour,
  buildEngagementProfile,
  buildSendTimeModel,
  type EngagementEvent,
  type EngagementProfile,
  type SendWindow,
} from "@/lib/campaigns/engagement";
import { suppressManyAction } from "../campaigns/actions";
import { tagContactsAction, untagContactsAction } from "./actions";

export const metadata = { title: "Subscribers · Mailflow" };

/**
 * Screen 2 — the contact list.
 *
 * Assembled from the same two datasets a campaign draws on plus the
 * register, so this page and an audience preview can never disagree
 * about who exists or who is contactable.
 */
export default async function SubscribersPage() {
  const broker = await currentBroker();

  const [settlements, deals, suppressions, campaigns, tagRows, tagCounts] =
    await Promise.all([
      listSettlements(),
      getSalestrekkerClient().listDeals(),
      repos().campaign.listSuppressions(5000),
      repos().campaign.list(),
      repos().contactTag.list(),
      repos().contactTag.counts(),
    ]);

  const tags: Record<string, string[]> = {};
  for (const row of tagRows) {
    (tags[row.email] ??= []).push(row.tag);
  }
  for (const list of Object.values(tags)) list.sort((a, b) => a.localeCompare(b));

  const subscribers = buildSubscribers({ settlements, deals, suppressions });
  const counts = countSubscribers(subscribers);

  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const allRecipients = (
    await Promise.all(
      campaigns.map((c) =>
        repos().campaign.listRecipients(c.id, { limit: 5000 }),
      ),
    )
  ).flat();

  /* Activity is built once for every contact that has any, rather than
     per row on selection — the recipient rows are already in memory, and
     a click should open the panel instantly. */
  const activity: Record<string, ActivityEvent[]> = {};
  const emailsWithHistory = new Set(allRecipients.map((r) => r.email));
  for (const s of subscribers) {
    if (!emailsWithHistory.has(s.email)) continue;
    activity[s.email] = buildActivity(s, allRecipients, campaignNames);
  }

  /* Engagement runs off the same recipient rows, grouped by address.
     The list-wide send-time model is built once from every click the
     firm has ever recorded — a single contact almost never has enough
     of their own, so the fallback is doing most of the work. */
  const eventsByEmail = new Map<string, EngagementEvent[]>();
  for (const r of allRecipients) {
    const list = eventsByEmail.get(r.email) ?? [];
    list.push({
      campaignId: r.campaignId,
      sentAt: r.sentAt,
      openedAt: r.openedAt,
      clickedAt: r.clickedAt,
    });
    eventsByEmail.set(r.email, list);
  }

  const listModel = buildSendTimeModel([...eventsByEmail.values()].flat());

  const engagement: Record<string, EngagementProfile> = {};
  const sendWindows: Record<string, SendWindow> = {};
  for (const [email, events] of eventsByEmail) {
    engagement[email] = buildEngagementProfile(email, events);
    const window = bestSendHour(events, listModel);
    if (window) sendWindows[email] = window;
  }

  const brokerNames = Object.fromEntries(TEAM.map((m) => [m.id, m.name]));
  const stageNames = Object.fromEntries(STAGES.map((s) => [s.id, s.shortLabel]));

  return (
    <>
      <MailflowNav
        active="subscribers"
        footer={
          <div className="rounded-md border border-hairline bg-paper px-2.5 py-2">
            <Eyebrow className="mb-1.5">Groups</Eyebrow>
            <GroupCount label="Back-book" value={counts.backBook} />
            <GroupCount label="Live pipeline" value={counts.pipeline} />
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent className="flex flex-col">
          <PageTitle
            title="Subscribers"
            context={`${counts.active} active · ${counts.unsubscribed} unsubscribed · ${counts.bounced} bounced`}
          />
          <SubscriberTable
            subscribers={subscribers}
            brokerNames={brokerNames}
            stageNames={stageNames}
            activity={activity}
            engagement={engagement}
            sendWindows={sendWindows}
            tags={tags}
            allTags={tagCounts}
            onSuppress={suppressManyAction}
            onTag={tagContactsAction}
            onUntag={untagContactsAction}
          />
        </MailflowContent>
      </div>
    </>
  );
}

function GroupCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[11px] text-ink-mute">{label}</span>
      <span className="text-[11px] font-semibold tabular-nums text-ink-soft">
        {value}
      </span>
    </div>
  );
}

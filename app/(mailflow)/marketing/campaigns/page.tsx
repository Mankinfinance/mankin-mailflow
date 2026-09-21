import Link from "next/link";
import { Mail } from "lucide-react";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { StatusPill } from "@/components/mailflow/StatusPill";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { NewCampaignButton } from "@/components/campaigns/NewCampaignButton";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos, type CampaignStats } from "@/lib/db/repos";
import { teamMember } from "@/lib/team";

export const metadata = { title: "Campaigns · Mailflow" };

/**
 * Screen 3 — everything sent or about to be, newest first.
 *
 * Numbers are right-aligned tabular, and a measure that does not exist
 * yet renders as an em dash rather than a zero: a scheduled campaign has
 * not failed to get opens, it simply has not been sent.
 */
export default async function MarketingCampaignsPage() {
  const broker = await currentBroker();
  const campaigns = await repos().campaign.list();
  const stats = new Map<string, CampaignStats>(
    await Promise.all(
      campaigns.map(
        async (c) =>
          [c.id, await repos().campaign.stats(c.id)] as [string, CampaignStats],
      ),
    ),
  );

  const sentCount = campaigns.filter((c) => c.status === "sent").length;

  return (
    <>
      <MailflowNav
        active="campaigns"
        footer={
          <div className="rounded-md border border-hairline bg-paper px-2.5 py-2">
            <Eyebrow className="mb-1">This month</Eyebrow>
            <div className="text-[11px] text-ink-mute">
              {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
              {sentCount} sent
            </div>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent>
          <PageTitle
            title="Campaigns"
            context={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · newest first`}
            actions={
              <>
                <Link
                  href="/marketing/suppressions"
                  className="mf-quiet flex h-[30px] items-center rounded-md border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-brand transition-colors hover:bg-paper-warm"
                >
                  Do-not-market list
                </Link>
                <NewCampaignButton />
              </>
            }
          />

          {campaigns.length === 0 ? <EmptyState /> : (
            <Card padded={false} className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                    <Th>Campaign</Th>
                    <Th>Broker</Th>
                    <Th>Status</Th>
                    <Th align="right">Sent</Th>
                    <Th align="right">Opened</Th>
                    <Th align="right">Clicked</Th>
                    <Th align="right">Opted out</Th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const s = stats.get(c.id);
                    // A campaign that has not started has no numbers to
                    // show — an em dash, never a zero.
                    const started = (s?.sent ?? 0) > 0 || c.status === "sent";
                    return (
                      <tr
                        key={c.id}
                        className="mf-quiet border-t transition-colors hover:bg-paper-warm"
                        style={{ borderColor: "var(--color-hairline-softer)" }}
                      >
                        <td className="px-3.5 py-2.5">
                          <Link
                            href={`/marketing/campaigns/${c.id}`}
                            className="block text-[12.5px] font-semibold text-brand-deep hover:underline"
                          >
                            {c.name}
                          </Link>
                          {c.subject ? (
                            <span className="mono mt-0.5 block truncate text-[10.5px] text-ink-mute">
                              {c.subject}
                            </span>
                          ) : (
                            <span
                              className="mono mt-0.5 block text-[10.5px] italic"
                              style={{ color: "var(--color-ink-annotation)" }}
                            >
                              No subject yet
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-[12px] text-ink-soft">
                          {teamMember(c.fromBrokerId).name}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <StatusPill status={c.status} />
                        </td>
                        <Td>{started ? `${s?.sent ?? 0}/${s?.total ?? 0}` : "—"}</Td>
                        <Td>{started ? (s?.opened ?? 0) : "—"}</Td>
                        <Td>{started ? (s?.clicked ?? 0) : "—"}</Td>
                        <Td>{started ? (s?.unsubscribed ?? 0) : "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </MailflowContent>
      </div>
    </>
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
      className={`px-3.5 py-2 text-[10.5px] font-bold uppercase text-ink-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ letterSpacing: "0.12em" }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-soft">
      {children}
    </td>
  );
}

/** Points at the product's actual advantage rather than apologising for
 *  being empty — the loan book is the thing MailerLite could never do. */
function EmptyState() {
  return (
    <div className="rounded-[10px] border border-dashed border-hairline bg-surface px-6 py-12 text-center">
      <div
        className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--color-paper-warm)" }}
      >
        <Mail size={17} strokeWidth={1.5} style={{ color: "#bc7d19" }} />
      </div>
      <h2
        className="text-[18px] text-brand-deep"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
      >
        No campaigns yet
      </h2>
      <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-ink-mute">
        Start from the loan book: pick a lender, a settlement vintage or a
        pipeline stage, and the audience is built for you.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <NewCampaignButton />
      </div>
    </div>
  );
}

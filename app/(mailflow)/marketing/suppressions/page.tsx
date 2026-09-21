import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import {
  SuppressionRegister,
  type RegisterRow,
} from "@/components/mailflow/SuppressionRegister";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { TEAM, teamMember } from "@/lib/team";

export const metadata = { title: "Do-not-market register · Mailflow" };

/**
 * Screen 8, internal half — the opt-out register.
 *
 * Every campaign checks this twice, when the audience resolves and again
 * at send, so this page is the record of who has opted out and when we
 * honoured it.
 */
export default async function SuppressionsPage() {
  const broker = await currentBroker();
  const [suppressions, campaigns] = await Promise.all([
    repos().campaign.listSuppressions(),
    repos().campaign.list(),
  ]);

  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));

  const rows: RegisterRow[] = suppressions.map((s) => ({
    email: s.email,
    reason: s.reason,
    addedBy: teamMember(s.addedBy).short,
    createdAt: s.createdAt.toISOString(),
    provenance: provenanceOf(s.reason, s.campaignId, campaignNames, s.addedBy),
  }));

  return (
    <>
      <MailflowNav
        active="subscribers"
        footer={
          <p className="rounded-md border border-hairline bg-paper px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute">
            Opt-outs are honoured across every campaign, and every change is
            logged.
          </p>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent>
          <PageTitle
            title="Do-not-market register"
            context={`${rows.length} address${rows.length === 1 ? "" : "es"} · excluded from every send automatically`}
          />
          <div className="max-w-[860px]">
            <SuppressionRegister
              rows={rows}
              brokers={TEAM.filter((m) => m.email).map((m) => ({
                id: m.id,
                name: m.name,
              }))}
              currentBrokerId={broker.id}
            />
          </div>
        </MailflowContent>
      </div>
    </>
  );
}

/** The one-line "where this came from" under each address. */
function provenanceOf(
  reason: string,
  campaignId: string | null,
  names: Map<string, string>,
  addedBy: string,
): string {
  if (reason === "unsubscribe") {
    const name = campaignId ? names.get(campaignId) : null;
    return name ? `${name} footer` : "Unsubscribe link in a campaign";
  }
  if (reason === "bounce") return "Hard bounce";
  return `Added by ${teamMember(addedBy).short}`;
}

import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { SettingsForm } from "@/components/mailflow/SettingsForm";
import { DatabasePanel } from "@/components/mailflow/DatabasePanel";
import { currentBroker } from "@/lib/auth/current-broker";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { repos } from "@/lib/db/repos";
import { buildSubscribers, countSubscribers } from "@/lib/campaigns/subscribers";
import { currentSettings } from "@/lib/mailflow/current-settings";
import { databaseConfig } from "@/lib/db/state";
import { settingsFromEnv } from "@/lib/mailflow/settings";
import { senderDomain, scheduledRunsPerDay } from "@/lib/mailflow/sending-config";

export const metadata = { title: "Settings · Mailflow" };

/**
 * Mailflow's own settings.
 *
 * Everything here used to be an environment variable, which meant the
 * person who writes the campaigns could not change the address printed
 * at the bottom of them. The env vars still work as a fallback, and the
 * form says when a value is coming from one.
 */
export default async function MailflowSettingsPage() {
  const broker = await currentBroker();

  const [settings, settlements, deals, suppressions, storedRow] =
    await Promise.all([
      currentSettings(),
      listSettlements(),
      getSalestrekkerClient().listDeals(),
      repos().campaign.listSuppressions(5000),
      repos().settings.get(),
    ]);

  const counts = countSubscribers(
    buildSubscribers({ settlements, deals, suppressions }),
  );

  /* Which values the store has not taken over yet, so the form can name
     the env var rather than leave a filled field unexplained. */
  const env = settingsFromEnv();
  const stored = (storedRow?.settings ?? {}) as Record<string, unknown>;
  const fromEnv = {
    postalAddress:
      !("postalAddress" in stored) && Boolean(env.postalAddress?.trim()),
    unsubscribeMailto:
      !("unsubscribeMailto" in stored) &&
      Boolean(env.unsubscribeMailto?.trim()),
  };

  const domain = senderDomain(broker.email);
  const runsPerDay = scheduledRunsPerDay();

  return (
    <>
      <MailflowNav active="settings" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          {/* First thing on the page, because "is any of this being
              kept" outranks every setting below it. */}
          <DatabasePanel
            config={databaseConfig()}
            detailHref="/marketing/settings/database"
          />
          <PageTitle
            title="Settings"
            context={
              storedRow
                ? `Last changed ${storedRow.updatedAt.toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}`
                : "Running on defaults — nothing saved yet"
            }
          />

          {/* Read-only, because the app cannot honestly claim otherwise. */}
          <Card className="mb-3.5 max-w-[640px]">
            <Eyebrow>Sending domain</Eyebrow>
            <p className="mono mt-1 text-[13px] text-brand-deep">{domain}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-mute">
              Mail goes out through Microsoft 365 from each broker&apos;s own
              mailbox, so this follows the tenant rather than anything set
              here.
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
              Whether SPF, DKIM and DMARC actually pass is a DNS question this
              app cannot answer for itself — it would only be repeating back
              what someone typed. Check it at the source before the first
              campaign:
            </p>
            <p className="mono mt-1.5 text-[11px] text-ink-mute">
              dig TXT {domain} · dig TXT _dmarc.{domain}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              The full sequence is in docs/deliverability.md.
            </p>
          </Card>

          <SettingsForm
            initial={settings}
            contactCount={counts.active}
            runsPerDay={runsPerDay}
            fromEnv={fromEnv}
          />
        </MailflowContent>
      </div>
    </>
  );
}

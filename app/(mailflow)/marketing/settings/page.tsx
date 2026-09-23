import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import { SettingsForm } from "@/components/mailflow/SettingsForm";
import { SignatureForm } from "@/components/mailflow/SignatureForm";
import { DatabasePanel } from "@/components/mailflow/DatabasePanel";
import { SenderAuthCard } from "@/components/mailflow/SenderAuthCard";
import { checkSenderAuth } from "@/lib/campaigns/sender-auth";
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

  const senderAuth = await checkSenderAuth(senderDomain(broker.email));
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

          <SenderAuthCard auth={senderAuth} />

          <SettingsForm
            initial={settings}
            contactCount={counts.active}
            runsPerDay={runsPerDay}
            fromEnv={fromEnv}
          />
          <SignatureForm
            initial={settings.signature}
            postalAddress={settings.postalAddress}
          />
        </MailflowContent>
      </div>
    </>
  );
}

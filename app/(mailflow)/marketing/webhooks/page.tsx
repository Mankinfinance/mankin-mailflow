import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import {
  WebhookManager,
  type EndpointView,
} from "@/components/webhooks/WebhookManager";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { WebhookEndpointConfigSchema } from "@/lib/webhooks/types";

export const metadata = { title: "Webhooks · Mailflow" };

/**
 * Webhooks — telling another system what just happened here.
 *
 * The event worth wiring first is the unsubscribe: without it, a
 * client who opts out of Mailflow keeps being mailed by whatever else
 * holds their address, and the firm looks like it ignored them.
 */
export default async function WebhooksPage() {
  const broker = await currentBroker();
  const rows = await repos().webhook.listEndpoints();

  const endpoints: EndpointView[] = await Promise.all(
    rows.map(async (row) => {
      const parsed = WebhookEndpointConfigSchema.safeParse(row.config);
      const deliveries = await repos().webhook.listDeliveries(row.id, 20);
      return {
        id: row.id,
        name: row.name,
        url: parsed.success ? parsed.data.url : "(unreadable)",
        description: parsed.success ? parsed.data.description : "",
        events: parsed.success ? parsed.data.events : [],
        enabled: row.enabled,
        consecutiveFailures: row.consecutiveFailures,
        lastDeliveredAt: row.lastDeliveredAt,
        lastFailedAt: row.lastFailedAt,
        deliveries: deliveries.map((d) => ({
          id: d.id,
          event: d.event,
          status: d.status,
          attempts: d.attempts,
          lastStatus: d.lastStatus,
          lastError: d.lastError,
          createdAt: d.createdAt,
        })),
      };
    }),
  );

  const failing = endpoints.filter((e) => e.consecutiveFailures >= 3).length;

  return (
    <>
      <MailflowNav active="webhooks" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <PageTitle
            title="Webhooks"
            context={
              endpoints.length === 0
                ? "Nothing wired up yet"
                : `${endpoints.length} ${endpoints.length === 1 ? "endpoint" : "endpoints"}${failing > 0 ? ` · ${failing} failing` : ""}`
            }
          />
          <p className="mb-4 max-w-[620px] text-[12px] leading-relaxed text-ink-mute">
            Mailflow POSTs a signed JSON payload when something happens here, so
            another system can act on it. Every delivery carries an HMAC
            signature over the body and a timestamp — your receiver should
            verify both, or anything that can reach your URL can claim a client
            unsubscribed.
          </p>
          <WebhookManager endpoints={endpoints} />
        </MailflowContent>
      </div>
    </>
  );
}

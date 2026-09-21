import Link from "next/link";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { TemplateGallerySection } from "@/components/mailflow/AutomationTemplates";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { teamMember } from "@/lib/team";
import { STAGES } from "@/lib/clients/salestrekker/types";
import { AutomationFlowSchema } from "@/lib/automations/types";
import { describeTrigger } from "@/lib/automations/triggers";

export const metadata = { title: "Automations · Mailflow" };

/**
 * Screen 6 — the sequences that run without anyone pressing send.
 *
 * The gallery sits below the list rather than behind a button: a
 * brokerage will have three or four of these ever, so the useful default
 * is "here is what else you could turn on", not a tidy empty page.
 */
export default async function AutomationsPage() {
  const broker = await currentBroker();
  const automations = await repos().automation.list();

  const stageLabels = Object.fromEntries(
    STAGES.map((s) => [s.id, s.shortLabel]),
  );

  const rows = await Promise.all(
    automations.map(async (a) => {
      const runs = await repos().automation.listRuns(a.id, { limit: 5000 });
      const parsed = AutomationFlowSchema.safeParse(a.flow);
      return {
        automation: a,
        entered: runs.length,
        inFlight: runs.filter((r) => r.status === "waiting").length,
        trigger: parsed.success
          ? describeTrigger(
              parsed.data.trigger,
              parsed.data.trigger.kind === "pipeline-stage"
                ? stageLabels[parsed.data.trigger.stageId]
                : undefined,
            )
          : "Unreadable sequence",
      };
    }),
  );

  const liveCount = rows.filter((r) => r.automation.status === "live").length;

  return (
    <>
      <MailflowNav
        active="automations"
        footer={
          <div className="rounded-md border border-hairline bg-paper px-2.5 py-2">
            <Eyebrow className="mb-1.5">Node types</Eyebrow>
            {[
              ["Trigger", "#0c034b"],
              ["Delay", "#5f636e"],
              ["Send", "#4151a8"],
              ["Condition", "#8a6a22"],
            ].map(([label, colour]) => (
              <div key={label} className="flex items-center gap-1.5 py-0.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="text-[10.5px] text-ink-mute">{label}</span>
              </div>
            ))}
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent>
          <PageTitle
            title="Automations"
            context={
              rows.length === 0
                ? "Nothing running yet"
                : `${liveCount} live · ${rows.length} in total`
            }
          />

          {rows.length > 0 && (
            <Card padded={false} className="mb-[22px] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                    <Th>Sequence</Th>
                    <Th>Sends from</Th>
                    <Th>Status</Th>
                    <Th align="right">Entered</Th>
                    <Th align="right">In flight</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ automation, entered, inFlight, trigger }) => (
                    <tr
                      key={automation.id}
                      className="mf-quiet border-t transition-colors hover:bg-paper-warm"
                      style={{ borderColor: "var(--color-hairline-softer)" }}
                    >
                      <td className="px-3.5 py-2.5">
                        <Link
                          href={`/marketing/automations/${automation.id}`}
                          className="block text-[12.5px] font-semibold text-brand-deep hover:underline"
                        >
                          {automation.name}
                        </Link>
                        <span className="mt-0.5 block text-[11px] text-ink-mute">
                          {trigger}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-[12px] text-ink-soft">
                        {teamMember(automation.fromBrokerId).short}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <AutomationStatusPill status={automation.status} />
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-soft">
                        {entered}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-soft">
                        {inFlight}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <TemplateGallerySection stageLabels={stageLabels} />
        </MailflowContent>
      </div>
    </>
  );
}

export function AutomationStatusPill({ status }: { status: string }) {
  const tone =
    status === "live"
      ? { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4" }
      : status === "paused"
        ? { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd" }
        : { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ backgroundColor: tone.bg, color: tone.ink, borderColor: tone.line }}
    >
      {status === "live" && (
        <span
          className="mf-pulse h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tone.ink }}
        />
      )}
      {status}
    </span>
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

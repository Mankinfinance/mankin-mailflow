import { notFound } from "next/navigation";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import { AutomationCanvas } from "@/components/mailflow/AutomationCanvas";
import { AutomationControls } from "@/components/mailflow/AutomationControls";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { teamMember } from "@/lib/team";
import { STAGES } from "@/lib/clients/salestrekker/types";
import { AutomationFlowSchema } from "@/lib/automations/types";
import { validateFlow } from "@/lib/automations/engine";

export const metadata = { title: "Sequence · Mailflow" };

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broker = await currentBroker();

  const automation = await repos().automation.get(id);
  if (!automation) notFound();

  const parsed = AutomationFlowSchema.safeParse(automation.flow);
  const [stats, runs] = await Promise.all([
    repos().automation.nodeStats(automation.id),
    repos().automation.listRuns(automation.id, { limit: 5000 }),
  ]);

  /* Where everyone currently sits. The canvas shows this per node
     because "six people are waiting somewhere in the sequence" is only
     useful once you can see which step they are waiting on. */
  const waitingByNode: Record<string, number> = {};
  for (const run of runs) {
    if (run.status !== "waiting") continue;
    waitingByNode[run.currentNodeId] = (waitingByNode[run.currentNodeId] ?? 0) + 1;
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const enteredThisMonth = runs.filter((r) => r.enteredAt >= startOfMonth).length;
  const inFlight = runs.filter((r) => r.status === "waiting").length;

  const stageLabels = Object.fromEntries(STAGES.map((s) => [s.id, s.shortLabel]));
  const problems = parsed.success ? validateFlow(parsed.data) : [];

  const context = [
    automation.activatedAt
      ? `Running since ${automation.activatedAt.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`
      : "Not turned on yet",
    `${runs.length} ${runs.length === 1 ? "contact has" : "contacts have"} entered`,
    `${inFlight} waiting somewhere in the sequence`,
    `Sends from ${teamMember(automation.fromBrokerId).name}`,
  ].join(" · ");

  return (
    <>
      <MailflowNav active="automations" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
          record={{
            name: automation.name,
            status: automation.status,
            backHref: "/marketing/automations",
          }}
        />
        <MailflowContent>
          <PageTitle
            title={automation.name}
            context={context}
            actions={
              <AutomationControls id={automation.id} status={automation.status} />
            }
          />

          {problems.length > 0 && automation.status !== "live" && (
            <div
              className="mb-4 rounded-md border px-3.5 py-2.5"
              style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
            >
              <p className="text-[12px] font-semibold" style={{ color: "#8a3733" }}>
                {problems.length === 1
                  ? "One thing to fix before this can run"
                  : `${problems.length} things to fix before this can run`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {problems.map((p) => (
                  <li key={p} className="text-[11.5px]" style={{ color: "#8a3733" }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed.success ? (
            <AutomationCanvas
              flow={parsed.data}
              stats={stats}
              waitingByNode={waitingByNode}
              entered={runs.length}
              enteredThisMonth={enteredThisMonth}
              stageLabel={
                parsed.data.trigger.kind === "pipeline-stage"
                  ? stageLabels[parsed.data.trigger.stageId]
                  : undefined
              }
            />
          ) : (
            <p className="text-[12.5px] text-danger">
              This sequence could not be read.
            </p>
          )}
        </MailflowContent>
      </div>
    </>
  );
}

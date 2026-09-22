import {
  Clock,
  GitBranch,
  LogOut,
  Mail,
  MessageSquareQuote,
  Shuffle,
  Zap,
} from "lucide-react";
import type { AutomationFlow, AutomationNode } from "@/lib/automations/types";
import { describeTrigger } from "@/lib/automations/triggers";
import { describeCondition } from "@/lib/automations/engine";
import type { AutomationNodeStats } from "@/lib/db/repos";

/**
 * The sequence, drawn.
 *
 * A vertical column of cards on a dotted canvas, with the condition
 * fanning into two labelled branches. Per-node counts sit on each card
 * because "how many people are sitting here right now" is the question a
 * broker actually opens this screen to answer — a flow diagram without
 * those numbers is documentation, not a dashboard.
 */

export interface AutomationCanvasProps {
  flow: AutomationFlow;
  stats: AutomationNodeStats[];
  /** How many runs are parked on each node. */
  waitingByNode: Record<string, number>;
  entered: number;
  enteredThisMonth: number;
  stageLabel?: string;
  /** Name of the form a signup trigger watches. */
  formName?: string;
  /** Team member names, so a broker condition reads as a person. */
  brokerNames?: Record<string, string>;
}

export function AutomationCanvas({
  flow,
  stats,
  waitingByNode,
  entered,
  enteredThisMonth,
  stageLabel,
  formName,
  brokerNames,
}: AutomationCanvasProps) {
  const statsByNode = new Map(stats.map((s) => [s.nodeId, s]));
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));

  /** Walk the trunk until a condition, which ends the linear run. */
  const trunk: AutomationNode[] = [];
  let cursor: string | null | undefined = flow.entryNodeId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const node = nodeById.get(cursor);
    if (!node) break;
    trunk.push(node);
    if (node.kind === "condition" || node.kind === "split") break;
    cursor = node.next;
  }

  /* A split forks the canvas the same way a condition does, so the
     branch renderer treats them alike — otherwise a split's two arms
     never got drawn at all. */
  const condition = trunk.find(
    (n) => n.kind === "condition" || n.kind === "split",
  );
  const branch = (startId: string | null | undefined): AutomationNode[] => {
    const out: AutomationNode[] = [];
    const seen = new Set<string>();
    let id = startId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const node = nodeById.get(id);
      if (!node) break;
      out.push(node);
      if (node.kind === "condition" || node.kind === "split") break;
      id = node.next;
    }
    return out;
  };

  return (
    <div
      className="rounded-[10px] border border-hairline px-6 py-7"
      style={{
        backgroundColor: "#fdfcf8",
        backgroundImage: "radial-gradient(#e6e2d6 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      <div className="mx-auto flex w-full max-w-[680px] flex-col items-center">
        <TriggerCard
          label={describeTrigger(flow.trigger, stageLabel, formName)}
          entered={entered}
          thisMonth={enteredThisMonth}
        />

        {trunk.map((node) => (
          <NodeWithConnector
            key={node.id}
            node={node}
            stats={statsByNode.get(node.id)}
            waiting={waitingByNode[node.id] ?? 0}
            brokerNames={brokerNames}
          />
        ))}

        {condition && (
          <div className="mt-0 w-full">
            <BranchArms />
            <div className="flex items-start justify-center gap-8">
              <BranchColumn
                label={condition.kind === "split" ? "B" : "NO"}
                tone="#8a6a22"
                nodes={branch(condition.nextNo)}
                statsByNode={statsByNode}
                waitingByNode={waitingByNode}
                brokerNames={brokerNames}
              />
              <BranchColumn
                label={condition.kind === "split" ? "A" : "YES"}
                tone="#2f6f4a"
                nodes={branch(condition.nextYes)}
                statsByNode={statsByNode}
                waitingByNode={waitingByNode}
                brokerNames={brokerNames}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Connector() {
  return <span className="block h-[26px] w-px" style={{ backgroundColor: "#c9cbd4" }} />;
}

function NodeWithConnector({
  node,
  stats,
  waiting,
  brokerNames,
}: {
  node: AutomationNode;
  stats?: AutomationNodeStats;
  waiting: number;
  brokerNames?: Record<string, string>;
}) {
  return (
    <>
      <Connector />
      <NodeCard
        node={node}
        stats={stats}
        waiting={waiting}
        brokerNames={brokerNames}
      />
    </>
  );
}

function TriggerCard({
  label,
  entered,
  thisMonth,
}: {
  label: string;
  entered: number;
  thisMonth: number;
}) {
  return (
    <div
      className="w-[330px] overflow-hidden rounded-[10px] border"
      style={{ borderColor: "#0c034b", boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ backgroundColor: "#0c034b" }}
      >
        <Zap size={13} strokeWidth={1.5} color="#ffffff" />
        <span
          className="text-[10px] font-bold uppercase text-white"
          style={{ letterSpacing: "0.12em" }}
        >
          Trigger
        </span>
      </div>
      <div className="bg-surface px-3 py-3">
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <NodeStats
          items={[
            { label: "Entered", value: entered },
            { label: "This month", value: thisMonth },
          ]}
        />
      </div>
    </div>
  );
}

const NODE_STYLE: Record<
  string,
  { header: string; ink: string; border: string; label: string }
> = {
  delay: { header: "#f2f2ef", ink: "#5f636e", border: "var(--color-hairline)", label: "Delay" },
  send: { header: "#eef1fb", ink: "#4151a8", border: "#cfd7f5", label: "Send" },
  condition: { header: "#fbf3e4", ink: "#8a6a22", border: "#e5d3ab", label: "Condition" },
  survey: { header: "#eefafa", ink: "#0a7c7f", border: "#b9dfe0", label: "Survey" },
  /* Same warm tone as a condition, because a split is a fork too —
     just one decided by share rather than by a question. */
  split: { header: "#fbf3e4", ink: "#8a6a22", border: "#e5d3ab", label: "Split" },
};

function NodeCard({
  node,
  stats,
  waiting,
  brokerNames,
}: {
  node: AutomationNode;
  stats?: AutomationNodeStats;
  waiting: number;
  brokerNames?: Record<string, string>;
}) {
  if (node.kind === "exit") {
    return (
      <div
        className="flex w-[180px] items-center justify-center gap-1.5 rounded-full border border-dashed px-3 py-1.5"
        style={{ backgroundColor: "#f6f6f3", borderColor: "var(--color-hairline)" }}
      >
        <LogOut size={12} strokeWidth={1.5} className="text-ink-mute" />
        <span className="text-[11.5px] font-semibold text-ink-mute">Exit</span>
      </div>
    );
  }

  const style = NODE_STYLE[node.kind];
  const Icon =
    node.kind === "delay"
      ? Clock
      : node.kind === "send"
        ? Mail
        : node.kind === "survey"
          ? MessageSquareQuote
          : node.kind === "split"
            ? Shuffle
            : GitBranch;

  return (
    <div
      className="w-[330px] overflow-hidden rounded-[10px] border bg-surface"
      style={{ borderColor: style.border, boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ backgroundColor: style.header }}
      >
        <Icon size={13} strokeWidth={1.5} style={{ color: style.ink }} />
        <span
          className="text-[10px] font-bold uppercase"
          style={{ letterSpacing: "0.12em", color: style.ink }}
        >
          {style.label}
        </span>
      </div>
      <div className="px-3 py-3">
        <p className="text-[13px] font-semibold text-ink">
          {titleFor(node, brokerNames)}
        </p>
        {(node.kind === "send" || node.kind === "survey") && node.subject && (
          <p className="mono mt-0.5 truncate text-[11px] text-ink-mute">
            {node.subject}
          </p>
        )}
        {node.kind === "split" && (
          <p className="mt-0.5 text-[11.5px] text-ink-mute">
            {node.splitPercent ?? 50}% one way, {100 - (node.splitPercent ?? 50)}% the
            other — fixed per contact
          </p>
        )}
        {node.kind === "condition" && (
          <p className="mt-0.5 text-[11.5px] text-ink-mute">
            {node.condition
              ? /* Nothing to wait for — the contact's record answers it
                   the moment the sequence reaches this step. */
                "Answered from the contact's record"
              : `Waits up to ${node.withinDays ?? 0} days for an answer`}
          </p>
        )}

        {(node.kind === "send" || node.kind === "survey") && stats && (
          <NodeStats
            items={[
              { label: "Sent", value: stats.sent },
              { label: "Opened", value: stats.opened, tone: "var(--color-series-1)" },
              { label: "Dropped", value: stats.dropped, muted: true },
            ]}
          />
        )}
        {node.kind === "delay" && (
          <NodeStats items={[{ label: "Waiting", value: waiting }]} />
        )}
        {node.kind === "condition" && (
          <NodeStats items={[{ label: "Waiting here", value: waiting }]} />
        )}
      </div>
    </div>
  );
}

function titleFor(
  node: AutomationNode,
  brokerNames?: Record<string, string>,
): string {
  if (node.label) return node.label;
  if (node.kind === "delay") {
    return node.days === 1 ? "Wait 1 day" : `Wait ${node.days ?? 0} days`;
  }
  if (node.kind === "condition") {
    if (node.condition) {
      return describeCondition(node.condition, { brokers: brokerNames });
    }
    return node.check === "clicked" ? "Clicked the link?" : "Opened the email?";
  }
  if (node.kind === "split") return "Split the contacts";
  if (node.kind === "survey") return "Ask for feedback";
  return node.id;
}

function NodeStats({
  items,
}: {
  items: Array<{ label: string; value: number; tone?: string; muted?: boolean }>;
}) {
  return (
    <div className="mt-2.5 flex gap-5 border-t border-hairline pt-2">
      {items.map((item) => (
        <div key={item.label}>
          <div
            className="text-[10px] font-bold uppercase text-ink-faint"
            style={{ letterSpacing: "0.1em" }}
          >
            {item.label}
          </div>
          <div
            className="text-[15px] font-semibold tabular-nums"
            style={{
              color: item.muted
                ? "var(--color-ink-zero)"
                : (item.tone ?? "var(--color-ink)"),
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The two orthogonal paths from a condition down to its branches.
 *
 * The x endpoints are the centres of the two 314px columns inside the
 * 660px row below (314/2 = 157, and 660 − 157 = 503), so each arm lands
 * on the branch it belongs to rather than near it.
 */
function BranchArms() {
  return (
    <svg viewBox="0 0 660 46" className="mx-auto block h-[46px] w-full max-w-[660px]">
      <path
        d="M330 0 V14 Q330 22 322 22 H165 Q157 22 157 30 V46"
        fill="none"
        stroke="#c9cbd4"
        strokeWidth={1}
      />
      <path
        d="M330 0 V14 Q330 22 338 22 H495 Q503 22 503 30 V46"
        fill="none"
        stroke="#c9cbd4"
        strokeWidth={1}
      />
    </svg>
  );
}

function BranchColumn({
  label,
  tone,
  nodes,
  statsByNode,
  waitingByNode,
  brokerNames,
}: {
  label: string;
  tone: string;
  nodes: AutomationNode[];
  statsByNode: Map<string, AutomationNodeStats>;
  waitingByNode: Record<string, number>;
  brokerNames?: Record<string, string>;
}) {
  return (
    <div className="flex w-[314px] flex-col items-center">
      <span
        className="mb-2 text-[10.5px] font-bold"
        style={{ letterSpacing: "0.1em", color: tone }}
      >
        {label}
      </span>
      {nodes.map((node, i) => (
        <div key={node.id} className="flex flex-col items-center">
          {i > 0 && <Connector />}
          <NodeCard
            node={node}
            stats={statsByNode.get(node.id)}
            waiting={waitingByNode[node.id] ?? 0}
            brokerNames={brokerNames}
          />
        </div>
      ))}
    </div>
  );
}

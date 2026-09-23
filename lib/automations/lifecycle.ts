import "server-only";
import { STAGES } from "@/lib/clients/salestrekker/types";
import { repos } from "@/lib/db/repos";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import { dealIdForSource } from "@/lib/campaigns/types";
import type { AutomationRow, AutomationRunRow } from "@/lib/db/schema";
import { describeTrigger } from "./triggers";
import type { Trigger } from "./types";

/**
 * Telling other systems that a sequence started or stopped for
 * somebody.
 *
 * The trigger is the news. "Sarah's loan passed its 12-month
 * anniversary" is a phone call whether or not she ever opens the email
 * the sequence sends — and until these events existed, the only trace
 * of it anywhere was that an email went out.
 *
 * The payload builders are pure so they can be tested without a
 * runner, and so the wording a receiver sees is decided in one place.
 */

/**
 * How a run ended.
 *
 * The line between the two events is who decided. A sequence that
 * reaches an end its author drew — an exit step, or a last step with
 * nothing after it — has done what it was built to do, whichever
 * branch it took. A sequence stopped by something outside it — an
 * opt-out, or a flow that could not be read — has not.
 *
 * An earlier draft of this split treated every exit step as leaving
 * early. Every template ends each branch on an exit step ("Followed up
 * once.", "Opened, nothing further"), so under that rule a sequence
 * would almost never report completing and every normal finish would
 * arrive as an exit — backwards for anyone routing on it.
 */
export type RunEnding =
  /** Reached an end the author designed. `nodeId` is the exit step
   *  when there was one; `note` is its canvas note, which says in the
   *  author's words what this ending means. */
  | { kind: "finished"; nodeId: string | null; note: string | null }
  /** Opted out mid-sequence. The sender checks before every step. */
  | { kind: "unsubscribed" }
  /** The sequence itself could not run. */
  | { kind: "broken"; error: string };

/**
 * Endpoints subscribe per event, so the split has to match how people
 * route: finishing goes to a follow-up list, being stopped goes to
 * whoever looks after the list or the sequence.
 */
export function endingEvent(
  ending: RunEnding,
): "automation.completed" | "automation.exited" {
  return ending.kind === "finished"
    ? "automation.completed"
    : "automation.exited";
}

/**
 * The trigger in the canvas's own words, so a Slack message and the
 * automation list never describe the same rule differently.
 */
export async function describeTriggerFor(trigger: Trigger): Promise<string> {
  const stageLabel =
    trigger.kind === "pipeline-stage"
      ? STAGES.find((s) => s.id === trigger.stageId)?.shortLabel
      : undefined;
  const formName =
    trigger.kind === "form-submission"
      ? ((await repos().form.get(trigger.formId))?.name ?? undefined)
      : undefined;
  return describeTrigger(trigger, stageLabel, formName);
}

/** Who and which sequence — carried by every lifecycle event. */
function runFields(automation: AutomationRow, run: AutomationRunRow) {
  return {
    automationId: automation.id,
    automationName: automation.name,
    runId: run.id,
    email: run.email,
    name: run.name || null,
    sourceKind: run.sourceKind,
    sourceId: run.sourceId,
    dealId: dealIdForSource(run.sourceKind, run.sourceId),
  };
}

export function enteredPayload(args: {
  automation: AutomationRow;
  run: AutomationRunRow;
  trigger: Trigger;
  triggerDescription: string;
}): Record<string, unknown> {
  return {
    ...runFields(args.automation, args.run),
    /* Structured, for a receiver that routes on it ("only equity
       milestones to the lending team"), and in words for one that
       just posts it. */
    trigger: args.trigger,
    triggerDescription: args.triggerDescription,
    enteredAt: args.run.enteredAt.toISOString(),
  };
}

export function endedPayload(args: {
  automation: AutomationRow;
  run: AutomationRunRow;
  ending: RunEnding;
  now: Date;
}): Record<string, unknown> {
  const { ending } = args;
  const days = Math.floor(
    (args.now.getTime() - args.run.enteredAt.getTime()) / 86_400_000,
  );
  const common = {
    ...runFields(args.automation, args.run),
    enteredAt: args.run.enteredAt.toISOString(),
    endedAt: args.now.toISOString(),
    daysInSequence: Math.max(0, days),
  };

  if (ending.kind === "finished") {
    return {
      ...common,
      /* Which end, so a receiver can tell "opened, broker picks it up"
         from "followed up once and left alone" — the two branches of
         the same sequence, and not the same news. */
      endNodeId: ending.nodeId,
      outcome: ending.note,
    };
  }
  return {
    ...common,
    reason: ending.kind,
    error: ending.kind === "broken" ? ending.error : null,
  };
}

export async function announceEntered(
  args: Parameters<typeof enteredPayload>[0],
): Promise<void> {
  await emitWebhook("automation.entered", enteredPayload(args));
}

export async function announceEnded(
  args: Parameters<typeof endedPayload>[0],
): Promise<void> {
  await emitWebhook(endingEvent(args.ending), endedPayload(args));
}

import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { teamMember } from "@/lib/team";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { sendMimeViaGraph } from "@/lib/clients/outlook-mime";
import { renderCampaign } from "@/lib/campaigns/merge";
import { buildRecipientLinks } from "@/lib/campaigns/tracking";
import { resolveAudience } from "@/lib/campaigns/audience";
import { defaultAudienceFilter, dealIdForSource } from "@/lib/campaigns/types";
import { automationTrackingId } from "@/lib/campaigns/tracked-message";
import { currentSettings } from "@/lib/mailflow/current-settings";
import type { AutomationRow, AutomationRunRow } from "@/lib/db/schema";
import { AutomationFlowSchema } from "./types";
import { announceEntered, announceEnded, describeTriggerFor } from "./lifecycle";
import { nextAction, type ContactFacts, type RunPosition } from "./engine";
import { surveyLink } from "@/lib/surveys/token";
import {
  evaluateTrigger,
  type SubmissionHit,
  type TagHit,
} from "./triggers";

/**
 * The automation runner: enrol newly eligible contacts, then advance
 * every run whose wait has expired.
 *
 * All the decisions live in the pure engine; this module only applies
 * them and writes the result down. One step per pass, each committed
 * before the next is decided, so a crash mid-sequence resumes where it
 * stopped rather than replaying a send.
 */

/** Runs advanced per pass. Each may send, so this is the same Exchange
 *  rate consideration the campaign sender has. */
const RUN_BUDGET = 80;

/**
 * Resolves a contact's current record for conditions that ask about
 * them, loading the book at most once per tick and only if some flow
 * actually asks.
 *
 * Most sequences branch on opens alone and need none of this, so paying
 * for the book on every tick would be a cost with no reader. Equally,
 * loading it per run would mean up to RUN_BUDGET reads of the same
 * three tables in one pass.
 */
function contactFactsLoader() {
  let loaded: Promise<{
    settlements: Awaited<ReturnType<typeof listSettlements>>;
    deals: Awaited<ReturnType<ReturnType<typeof getSalestrekkerClient>["listDeals"]>>;
    tagsByEmail: Map<string, string[]>;
  }> | null = null;

  const load = () => {
    loaded ??= (async () => {
      const [settlements, deals, tagRows] = await Promise.all([
        listSettlements(),
        getSalestrekkerClient().listDeals(),
        repos().contactTag.list(),
      ]);
      const tagsByEmail = new Map<string, string[]>();
      for (const row of tagRows) {
        const key = row.email.toLowerCase();
        const list = tagsByEmail.get(key) ?? [];
        list.push(row.tag.toLowerCase());
        tagsByEmail.set(key, list);
      }
      return { settlements, deals, tagsByEmail };
    })();
    return loaded;
  };

  return async function factsFor(email: string): Promise<ContactFacts | null> {
    const key = email.trim().toLowerCase();
    const { settlements, deals, tagsByEmail } = await load();
    const tags = tagsByEmail.get(key) ?? [];

    /* Back-book first, the same precedence the subscriber list and the
       audience resolver use — it is the record that carries the loan. */
    const settlement = settlements.find(
      (x) => x.email.trim().toLowerCase() === key,
    );
    if (settlement) {
      return {
        tags,
        lenderCode: settlement.lenderCode || null,
        currentBalance: settlement.currentBalance,
        settlementDate: settlement.settlementDate || null,
        brokerId: settlement.brokerId,
      };
    }

    const deal = deals.find((x) => x.email.trim().toLowerCase() === key);
    if (deal) {
      return {
        tags,
        lenderCode: null,
        currentBalance: null,
        settlementDate: null,
        brokerId: deal.brokerId,
      };
    }

    /* Nowhere in the book. Tags alone are still answerable, so this is
       a record rather than null — a "has tag" branch should not stop a
       sequence just because the loan has since discharged. */
    return tags.length > 0
      ? {
          tags,
          lenderCode: null,
          currentBalance: null,
          settlementDate: null,
          brokerId: null,
        }
      : null;
  };
}

export interface AutomationTickResult {
  automations: number;
  enrolled: number;
  advanced: number;
  sent: number;
  failed: number;
  exited: number;
}

export async function tickAutomations(
  now: Date = new Date(),
): Promise<AutomationTickResult> {
  const result: AutomationTickResult = {
    automations: 0,
    enrolled: 0,
    advanced: 0,
    sent: 0,
    failed: 0,
    exited: 0,
  };

  const live = await repos().automation.list({ statuses: ["live"] });
  result.automations = live.length;

  if (live.length > 0) {
    const [settlements, deals] = await Promise.all([
      listSettlements(),
      getSalestrekkerClient().listDeals(),
    ]);
    for (const automation of live) {
      result.enrolled += await enrol(automation, settlements, deals, now);
    }
  }

  // Advance due runs across every automation, live or paused-mid-flight:
  // someone already in a sequence should finish it even if the broker
  // stops new people entering.
  const due = await repos().automation.dueRuns(now, RUN_BUDGET);
  const factsFor = contactFactsLoader();
  for (const run of due) {
    const automation = await repos().automation.get(run.automationId);
    if (!automation) continue;
    if (automation.status === "paused") continue;
    const outcome = await advanceRun(automation, run, now, factsFor);
    result.advanced += 1;
    result.sent += outcome.sent;
    result.failed += outcome.failed;
    result.exited += outcome.exited;
  }

  await auditLog({
    actor: { type: "system" },
    action: "automation.tick",
    meta: { ...result },
  });

  return result;
}

/** Put newly eligible contacts at the start of the sequence. */
async function enrol(
  automation: AutomationRow,
  settlements: Awaited<ReturnType<typeof listSettlements>>,
  deals: Awaited<ReturnType<ReturnType<typeof getSalestrekkerClient>["listDeals"]>>,
  now: Date,
): Promise<number> {
  const flow = AutomationFlowSchema.safeParse(automation.flow);
  if (!flow.success) return 0;

  const [alreadyEnrolled, suppressedRows] = await Promise.all([
    repos().automation.enrolledEmails(automation.id),
    repos().campaign.listSuppressions(5000),
  ]);
  const suppressed = new Set(suppressedRows.map((r) => r.email));

  /* Loaded per trigger kind rather than always: a sequence started by
     a settlement anniversary has no use for the enquiry table, and an
     enrolment pass runs for every live automation on every tick. */
  let submissions: SubmissionHit[] | undefined;
  let tagEvents: TagHit[] | undefined;

  if (flow.data.trigger.kind === "form-submission") {
    const rows = await repos().form.listSubmissions(
      flow.data.trigger.formId,
      1000,
    );
    submissions = rows.flatMap((r) =>
      r.email
        ? [
            {
              formId: r.formId,
              email: r.email,
              name: r.name,
              submittedAt: r.submittedAt,
              dealId: r.dealId,
            },
          ]
        : [],
    );
  }

  if (flow.data.trigger.kind === "tag-added") {
    const rows = await repos().contactTag.list();
    tagEvents = rows.map((r) => ({
      email: r.email,
      tag: r.tag,
      addedAt: r.createdAt,
    }));
  }

  /* Merge fields come from the campaign audience resolver, so an
     automation email and a campaign email merge identically — one
     definition of what {{lender}} means, not two. */
  const hits = evaluateTrigger({
    trigger: flow.data.trigger,
    settlements,
    deals,
    today: now,
    submissions,
    tagEvents,
    alreadyEnrolled,
    suppressed,
    fieldsForSettlement: (s) =>
      resolveAudience({
        /* Spread the defaults rather than spelling every field out:
           this call only cares about the merge fields, so a filter
           gaining a field should not break it. */
        filter: {
          ...defaultAudienceFilter(),
          sources: ["settlements"],
          loanStatus: ["active", "closed", "discharged"],
        },
        settlements: [s],
        deals: [],
        today: now,
      }).members[0]?.fields ?? {},
    fieldsForDeal: (d) =>
      resolveAudience({
        filter: {
          ...defaultAudienceFilter(),
          sources: ["deals"],
          loanStatus: ["active"],
        },
        settlements: [],
        deals: [d],
        today: now,
      }).members[0]?.fields ?? {},
  });

  let enrolled = 0;
  /* Worked out once per pass, and only when somebody is actually being
     enrolled — a form-triggered sequence would otherwise look its form
     up on every tick for nobody. */
  const triggerDescription =
    hits.length > 0 ? await describeTriggerFor(flow.data.trigger) : "";

  for (const hit of hits) {
    const run = await repos().automation.startRun({
      automationId: automation.id,
      email: hit.email,
      name: hit.name,
      sourceKind: hit.sourceKind,
      sourceId: hit.sourceId,
      fields: hit.fields,
      status: "waiting",
      currentNodeId: flow.data.entryNodeId,
      nodeEnteredAt: now,
      // Due immediately; the engine decides whether that means send now
      // or start a delay.
      nextRunAt: now,
    });
    /* startRun returns null for someone already enrolled, so this
       announces each person once per sequence, not once per tick. */
    if (run) {
      enrolled += 1;
      await announceEntered({
        automation,
        run,
        trigger: flow.data.trigger,
        triggerDescription,
      });
    }
  }
  return enrolled;
}

interface AdvanceOutcome {
  sent: number;
  failed: number;
  exited: number;
}

/** Apply exactly one engine decision to one run. */
async function advanceRun(
  automation: AutomationRow,
  run: AutomationRunRow,
  now: Date,
  factsFor: (email: string) => Promise<ContactFacts | null>,
): Promise<AdvanceOutcome> {
  const outcome: AdvanceOutcome = { sent: 0, failed: 0, exited: 0 };

  const parsed = AutomationFlowSchema.safeParse(automation.flow);
  if (!parsed.success) {
    const error = "The sequence is malformed and could not be read.";
    await repos().automation.updateRun(run.id, {
      status: "done",
      error,
      finishedAt: now,
    });
    await announceEnded({ automation, run, now, ending: { kind: "broken", error } });
    return outcome;
  }
  const flow = parsed.data;

  /* An opt-out mid-sequence stops it immediately. Checking here as well
     as at entry is the same reasoning as the campaign sender: someone
     can unsubscribe from step one while step two is still queued. */
  const suppressed = await repos().campaign.suppressedAmong([run.email]);
  if (suppressed.has(run.email)) {
    await repos().automation.updateRun(run.id, {
      status: "exited",
      error: "Unsubscribed during the sequence.",
      finishedAt: now,
    });
    await announceEnded({ automation, run, now, ending: { kind: "unsubscribed" } });
    outcome.exited += 1;
    return outcome;
  }

  const lastSend = await repos().automation.latestSendForRun(run.id);

  /* Only resolved when the flow actually asks something about the
     contact. A sequence that branches on opens alone should not make
     the runner read the book. */
  const asksAboutContact = flow.nodes.some(
    (n) => n.kind === "condition" && n.condition,
  );

  const position: RunPosition = {
    nodeId: run.currentNodeId,
    enteredNodeAt: run.nodeEnteredAt,
    lastSend: lastSend?.sentAt
      ? {
          at: lastSend.sentAt,
          openedAt: lastSend.openedAt,
          clickedAt: lastSend.clickedAt,
        }
      : null,
    contact: asksAboutContact ? await factsFor(run.email) : null,
    /* What a split hashes on. Their address, so the side they land on
       never changes between retries. */
    splitKey: run.email,
  };

  const action = nextAction(flow, position, now);

  switch (action.type) {
    case "wait":
      await repos().automation.updateRun(run.id, {
        status: "waiting",
        currentNodeId: action.nodeId,
        nextRunAt: action.until,
      });
      return outcome;

    case "move":
      await repos().automation.updateRun(run.id, {
        status: "waiting",
        currentNodeId: action.nodeId,
        // Arrival is stamped so a delay on the next node is measured
        // from here; nextRunAt only says "look again now".
        nodeEnteredAt: now,
        nextRunAt: now,
      });
      return outcome;

    case "exit":
      await repos().automation.updateRun(run.id, {
        status: "done",
        currentNodeId: action.nodeId,
        nextRunAt: null,
        finishedAt: now,
      });
      await announceEnded({
        automation,
        run,
        now,
        ending: {
          kind: "finished",
          nodeId: action.nodeId,
          /* The author's own words for this ending, from the canvas. */
          note:
            flow.nodes.find((n) => n.id === action.nodeId)?.note?.trim() ||
            null,
        },
      });
      outcome.exited += 1;
      return outcome;

    case "broken":
      await repos().automation.updateRun(run.id, {
        status: "done",
        nextRunAt: null,
        finishedAt: now,
        error: action.reason,
      });
      console.error(`[automation ${automation.id}] ${action.reason}`);
      await announceEnded({
        automation,
        run,
        now,
        ending: { kind: "broken", error: action.reason },
      });
      return outcome;

    case "send": {
      const send = await repos().automation.recordSend({
        runId: run.id,
        automationId: automation.id,
        nodeId: action.nodeId,
        email: run.email,
      });

      try {
        // Read per send, like campaigns: a sequence runs for weeks, and
        // a footer changed today should apply to tomorrow's step.
        const settings = await currentSettings();
        const links = await buildRecipientLinks({
          /* Names this exact send, so opens and clicks are recorded on
             it and a condition judging it sees them. Was
             `auto:<automationId>` alone, which no tracking route
             could resolve — every engagement was dropped. */
          campaignId: automationTrackingId(automation.id, send.id),
          email: run.email,
          trackOpens: automation.trackOpens,
          trackClicks: automation.trackClicks,
        });
        const rendered = renderCampaign({
          subject: action.subject,
          body: action.body,
          fields: run.fields ?? {},
          brokerId: automation.fromBrokerId,
          links,
          postalAddress: settings.postalAddress,
        });
        // Same MIME path as campaigns: a sequence is bulk mail too, and
        // needs the same unsubscribe headers and text alternative.
        const sender = teamMember(automation.fromBrokerId);
        await sendMimeViaGraph({
          fromEmail: sender.email,
          fromName: sender.name,
          to: run.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          unsubscribeUrl: links.oneClickUrl,
          unsubscribeMailto: settings.unsubscribeMailto || undefined,
        });
        await repos().automation.updateSend(send.id, { sentAt: now });
        outcome.sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repos().automation.updateSend(send.id, {
          error: message.slice(0, 500),
        });
        outcome.failed += 1;
        console.error(
          `[automation ${automation.id}] send failed for ${run.email}: ${message}`,
        );
      }

      // Move on whether the send worked or not — a failed send is a
      // dropped step, not a stuck contact.
      if (action.thenNodeId) {
        await repos().automation.updateRun(run.id, {
          status: "waiting",
          currentNodeId: action.thenNodeId,
          nodeEnteredAt: now,
          nextRunAt: now,
        });
      } else {
        await repos().automation.updateRun(run.id, {
          status: "done",
          nextRunAt: null,
          finishedAt: now,
        });
        // The last step. Everything the sequence had, they received.
        await announceEnded({
          automation,
          run,
          now,
          ending: { kind: "finished", nodeId: null, note: null },
        });
        outcome.exited += 1;
      }
      return outcome;
    }

    case "survey": {
      /* A survey invitation is an ordinary send with one extra field:
         a link signed for this recipient and this survey, which is why
         the engine hands the node over rather than resolving it — the
         signing is async and server-only. */
      const send = await repos().automation.recordSend({
        runId: run.id,
        automationId: automation.id,
        nodeId: action.nodeId,
        email: run.email,
      });

      try {
        const settings = await currentSettings();
        const link = await surveyLink({
          surveyId: action.surveyId,
          email: run.email,
          name: run.name,
          /* Signed into the link, so the answer can be noted on this
             client's deal notes. Without it a response names an
             address and nothing else. */
          dealId: dealIdForSource(run.sourceKind, run.sourceId),
        });
        const links = await buildRecipientLinks({
          /* Names this exact send, so opens and clicks are recorded on
             it and a condition judging it sees them. Was
             `auto:<automationId>` alone, which no tracking route
             could resolve — every engagement was dropped. */
          campaignId: automationTrackingId(automation.id, send.id),
          email: run.email,
          /* Click-wrapping the survey link would put the response
             behind a redirect that counts a click and then forwards —
             harmless, but it makes the address in the status bar ours
             rather than the one the email shows, on a link asking for
             candour. Opens are still tracked. */
          trackOpens: automation.trackOpens,
          trackClicks: false,
        });
        const rendered = renderCampaign({
          subject: action.subject,
          body: action.body,
          fields: { ...(run.fields ?? {}), survey_link: link },
          brokerId: automation.fromBrokerId,
          links,
          postalAddress: settings.postalAddress,
        });
        const sender = teamMember(automation.fromBrokerId);
        await sendMimeViaGraph({
          fromEmail: sender.email,
          fromName: sender.name,
          to: run.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          unsubscribeUrl: links.oneClickUrl,
          unsubscribeMailto: settings.unsubscribeMailto || undefined,
        });
        await repos().automation.updateSend(send.id, { sentAt: now });
        /* Counted here rather than on response, because the response
           rate needs to know how many were asked. */
        await repos().survey.countSent(action.surveyId, 1);
        outcome.sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repos().automation.updateSend(send.id, {
          error: message.slice(0, 500),
        });
        outcome.failed += 1;
        console.error(
          `[automation ${automation.id}] survey invite failed for ${run.email}: ${message}`,
        );
      }

      if (action.thenNodeId) {
        await repos().automation.updateRun(run.id, {
          status: "waiting",
          currentNodeId: action.thenNodeId,
          nodeEnteredAt: now,
          nextRunAt: now,
        });
      } else {
        await repos().automation.updateRun(run.id, {
          status: "done",
          nextRunAt: null,
          finishedAt: now,
        });
        // The last step. Everything the sequence had, they received.
        await announceEnded({
          automation,
          run,
          now,
          ending: { kind: "finished", nodeId: null, note: null },
        });
        outcome.exited += 1;
      }
      return outcome;
    }
  }
}

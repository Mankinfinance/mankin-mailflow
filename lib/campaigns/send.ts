import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { teamMember } from "@/lib/team";
import { OutlookAppOnlySendError } from "@/lib/clients/outlook-app-only";
import {
  sendMimeViaGraph,
  OutlookMimeSendError,
} from "@/lib/clients/outlook-mime";
import type { CampaignRow, CampaignRecipientRow } from "@/lib/db/schema";
import { renderCampaign } from "./merge";
import { buildRecipientLinks } from "./tracking";
import { decideWinner, subjectFor } from "./ab-test";
import { RUN_BUDGET } from "./send-limits";
import { currentSettings } from "@/lib/mailflow/current-settings";

/**
 * The send loop. Drains a campaign's pending recipients, one email each,
 * and records what happened to every one of them.
 *
 * App-only Graph rather than the broker's delegated token, because a
 * campaign is dispatched by the cron with nobody signed in. It still
 * sends *as* the owning broker's mailbox, so replies land with the
 * person who has the relationship and the send appears in their Sent
 * Items.
 *
 * Deliberately serial with a small per-run cap. A back-book blast is
 * hundreds of messages, and Exchange Online throttles a mailbox that
 * fires them off in parallel — the cron simply comes back for the next
 * slice, which also keeps each invocation inside the function timeout.
 */

export {
  BATCH_SIZE,
  RUN_BUDGET,
  FIRST_BATCH_SIZE,
} from "./send-limits";

export interface DispatchResult {
  campaignId: string;
  sent: number;
  failed: number;
  skipped: number;
  /** True when every recipient has now reached a terminal state. */
  complete: boolean;
}

/**
 * Send one recipient's copy. Exported for the "send me a test" button,
 * which renders exactly what the customer would receive — same merge
 * values, same footer — rather than an approximation of it.
 */
export async function sendOneCampaignEmail(args: {
  campaign: CampaignRow;
  recipient: Pick<
    CampaignRecipientRow,
    "email" | "firstName" | "name" | "fields" | "variant"
  >;
  /** Override the destination, for a test send to the broker. */
  toOverride?: string;
}): Promise<void> {
  const { campaign, recipient } = args;
  const settings = await currentSettings();
  const links = await buildRecipientLinks({
    campaignId: campaign.id,
    email: recipient.email,
    trackOpens: campaign.trackOpens,
    trackClicks: campaign.trackClicks,
  });

  const rendered = renderCampaign({
    // Which of the two subjects this recipient was assigned, or the
    // winning one if they were held back for it.
    subject: subjectFor(campaign, recipient.variant),
    body: campaign.body,
    fields: recipient.fields ?? {},
    brokerId: campaign.fromBrokerId,
    links,
    postalAddress: settings.postalAddress,
  });

  /* Sent as raw MIME rather than through Graph's JSON body, because
     that is the only way to set List-Unsubscribe and ship a real
     plain-text alternative — see lib/clients/outlook-mime.ts. Both are
     required for bulk mail to reach a Gmail inbox at all. */
  const sender = teamMember(campaign.fromBrokerId);
  await sendMimeViaGraph({
    fromEmail: sender.email,
    fromName: sender.name,
    to: args.toOverride ?? recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeUrl: links.oneClickUrl,
    unsubscribeMailto: settings.unsubscribeMailto || undefined,
  });
}

/**
 * Work through the next slice of a campaign's queue.
 *
 * The suppression list is re-checked here rather than trusted from
 * audience-resolve time: a customer can unsubscribe from Monday's send
 * while Tuesday's is still sitting in the queue, and the later opt-out
 * has to win.
 */
export async function dispatchCampaignBatch(
  campaign: CampaignRow,
  opts: { batchSize?: number } = {},
): Promise<DispatchResult> {
  const campaignRepo = repos().campaign;
  /* The broker's chosen pace, unless the caller named one — the inline
     first batch after a "Send" click passes its own, much smaller. */
  const settings = await currentSettings();
  const batch = await campaignRepo.nextPending(
    campaign.id,
    opts.batchSize ?? settings.batchSize,
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  if (batch.length > 0) {
    const suppressed = await campaignRepo.suppressedAmong(
      batch.map((r) => r.email),
    );

    if (campaign.startedAt === null) {
      await campaignRepo.update(campaign.id, {
        status: "sending",
        startedAt: new Date(),
      });
    }

    for (const recipient of batch) {
      if (suppressed.has(recipient.email)) {
        await campaignRepo.updateRecipient(recipient.id, {
          status: "skipped",
          skipReason: "suppressed",
        });
        skipped += 1;
        continue;
      }

      try {
        await sendOneCampaignEmail({ campaign, recipient });
        await campaignRepo.updateRecipient(recipient.id, {
          status: "sent",
          sentAt: new Date(),
          error: null,
        });
        sent += 1;
      } catch (err) {
        const message =
          err instanceof OutlookMimeSendError ||
          err instanceof OutlookAppOnlySendError
            ? `${err.message} ${err.body ?? ""}`.trim()
            : err instanceof Error
              ? err.message
              : String(err);
        // Terminal, not retried: a bounce-worthy address or a rejected
        // mailbox will fail identically next run, and quietly retrying
        // it forever would hide the problem from the results panel.
        await campaignRepo.updateRecipient(recipient.id, {
          status: "failed",
          error: message.slice(0, 500),
        });
        failed += 1;
        console.error(
          `[campaign ${campaign.id}] send failed for ${recipient.email}: ${message}`,
        );
      }
    }
  }

  const remaining = await campaignRepo.nextPending(campaign.id, 1);
  const complete = remaining.length === 0;
  if (complete) {
    await campaignRepo.update(campaign.id, {
      status: "sent",
      completedAt: new Date(),
    });
  }

  await auditLog({
    actor: { type: "system" },
    action: "campaign.batch.send",
    meta: {
      campaignId: campaign.id,
      name: campaign.name,
      sent,
      failed,
      skipped,
      complete,
    },
  });

  return { campaignId: campaign.id, sent, failed, skipped, complete };
}

/**
 * Run every campaign the cron owes work to: those already sending, and
 * those scheduled for a time that has now passed.
 *
 * One batch per campaign per run, so a 2,000-person blast can't starve
 * a small one queued behind it, and a shared per-run budget so a dozen
 * due campaigns can't run the invocation past its timeout. Whatever the
 * budget doesn't cover is still pending, and the next run picks it up.
 */
export async function dispatchDueCampaigns(
  now: Date = new Date(),
  opts: { runBudget?: number } = {},
): Promise<DispatchResult[]> {
  const due = await repos().campaign.dueForDispatch(now);
  const results: DispatchResult[] = [];
  let budget = opts.runBudget ?? RUN_BUDGET;

  const { batchSize: pace } = await currentSettings();

  for (const campaign of due) {
    if (budget <= 0) {
      console.log(
        `[campaign] run budget spent; ${campaign.id} waits for the next run`,
      );
      break;
    }
    try {
      const result = await dispatchCampaignBatch(campaign, {
        // The broker's pace, or whatever is left of this run's budget,
        // whichever is smaller.
        batchSize: Math.min(pace, budget),
      });
      budget -= result.sent + result.failed + result.skipped;
      results.push(result);
    } catch (err) {
      console.error(`[campaign ${campaign.id}] batch failed`, err);
    }
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* A/B decision                                                               */
/* -------------------------------------------------------------------------- */

export interface AbDecisionResult {
  campaignId: string;
  name: string;
  winner: "a" | "b";
  reason: string;
  released: number;
}

/**
 * Call any subject-line test whose window has closed, and release its
 * holdback to the winning subject.
 *
 * Runs from the same cron as the sender and before it, so a campaign
 * decided this tick starts sending the remainder in the same tick
 * rather than waiting an hour for the next one.
 *
 * A campaign whose test cannot be called yet is simply left alone. The
 * holdback stays put — it is already frozen, and nothing about waiting
 * costs anything except the delay the broker asked for.
 */
export async function decideDueAbTests(
  now: Date = new Date(),
): Promise<AbDecisionResult[]> {
  const campaignRepo = repos().campaign;
  const campaigns = await campaignRepo.list();
  const out: AbDecisionResult[] = [];

  for (const campaign of campaigns) {
    if (!campaign.subjectB?.trim()) continue;
    if (campaign.abWinner) continue;
    if (campaign.status !== "sending" && campaign.status !== "sent") continue;

    const recipients = await campaignRepo.listRecipients(campaign.id, {
      limit: 20_000,
    });

    let aSent = 0;
    let aOpened = 0;
    let bSent = 0;
    let bOpened = 0;
    let pendingInTest = 0;

    for (const r of recipients) {
      if (r.variant !== "a" && r.variant !== "b") continue;
      if (r.status === "pending") {
        pendingInTest += 1;
        continue;
      }
      if (r.status !== "sent") continue; // failed and skipped tell us nothing
      if (r.variant === "a") {
        aSent += 1;
        if (r.openedAt) aOpened += 1;
      } else {
        bSent += 1;
        if (r.openedAt) bOpened += 1;
      }
    }

    const decision = decideWinner({
      aSent,
      aOpened,
      bSent,
      bOpened,
      pendingInTest,
      startedAt: campaign.startedAt,
      decideAfterHours: campaign.abDecideAfterHours,
      now,
    });
    if (!decision.winner) continue;

    await campaignRepo.update(campaign.id, {
      abWinner: decision.winner,
      abDecidedAt: now,
    });
    const released = await campaignRepo.releaseHoldback(campaign.id);

    /* The campaign was marked sent when the test arm finished, because
       at that moment nothing was pending. Releasing the holdback gives
       it work again. */
    if (released > 0 && campaign.status === "sent") {
      await campaignRepo.update(campaign.id, {
        status: "sending",
        completedAt: null,
      });
    }

    await auditLog({
      actor: { type: "system" },
      action: "campaign.ab.decided",
      meta: {
        campaignId: campaign.id,
        name: campaign.name,
        winner: decision.winner,
        reason: decision.reason,
        aSent,
        aOpened,
        bSent,
        bOpened,
        released,
      },
    });

    out.push({
      campaignId: campaign.id,
      name: campaign.name,
      winner: decision.winner,
      reason: decision.reason,
      released,
    });
  }

  return out;
}

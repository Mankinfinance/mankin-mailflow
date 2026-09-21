"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { listSettlements } from "@/lib/settlements-store";
import { teamMember } from "@/lib/team";
import type { NewCampaignRecipient } from "@/lib/db/schema";
import { MERGE_FIELDS, resolveAudience } from "@/lib/campaigns/audience";
import { unknownMergeFields } from "@/lib/campaigns/merge";
import { assignVariants } from "@/lib/campaigns/ab-test";
import {
  sendOneCampaignEmail,
  dispatchCampaignBatch,
  FIRST_BATCH_SIZE,
} from "@/lib/campaigns/send";
import {
  AudienceFilterSchema,
  defaultAudienceFilter,
  isEditable,
  type AudienceFilter,
  type AudienceMember,
  type CampaignStatus,
} from "@/lib/campaigns/types";

/**
 * Server actions behind the campaigns surface.
 *
 * Every one of them is admin-gated. A campaign reaches the whole
 * back-book in one click and carries the firm's name into hundreds of
 * inboxes — that is a business-wide action, unlike the one-to-one
 * comms any broker can send from their own deals.
 */

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const DENIED = "Admin access required to manage campaigns.";

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return { ok: false, error: DENIED };
  return { ok: true, brokerId: broker.id };
}

/* -------------------------------------------------------------------------- */
/* Drafting                                                                   */
/* -------------------------------------------------------------------------- */

export async function createCampaignAction(
  name: string,
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the campaign a name." };

  const campaign = await repos().campaign.create({
    name: trimmed,
    subject: "",
    body: "",
    status: "draft",
    audience: defaultAudienceFilter(),
    fromBrokerId: auth.brokerId,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.create",
    meta: { campaignId: campaign.id, name: trimmed },
  });
  revalidatePath("/marketing/campaigns");
  return { ok: true, id: campaign.id };
}

export interface CampaignDraftInput {
  id: string;
  name: string;
  subject: string;
  subjectB: string;
  abTestPercent: number;
  body: string;
  fromBrokerId: string;
  audience: unknown;
  trackOpens: boolean;
  trackClicks: boolean;
}

export async function saveCampaignAction(
  input: CampaignDraftInput,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(input.id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (!isEditable(campaign.status as CampaignStatus)) {
    return {
      ok: false,
      error: `A campaign that is ${campaign.status} can no longer be edited.`,
    };
  }

  const parsed = AudienceFilterSchema.safeParse(input.audience);
  if (!parsed.success) {
    return { ok: false, error: "That audience filter isn't valid." };
  }

  await repos().campaign.update(input.id, {
    name: input.name.trim(),
    subject: input.subject,
    // Empty string means no test; stored as null so the column reads
    // the same way everywhere that checks it.
    subjectB: input.subjectB.trim() ? input.subjectB : null,
    abTestPercent: input.abTestPercent,
    body: input.body,
    fromBrokerId: input.fromBrokerId,
    audience: parsed.data,
    trackOpens: input.trackOpens,
    trackClicks: input.trackClicks,
  });

  revalidatePath(`/marketing/campaigns/${input.id}`);
  return { ok: true };
}

export async function deleteCampaignAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "sending") {
    return {
      ok: false,
      error: "Pause the campaign before deleting it, so a batch isn't mid-flight.",
    };
  }

  await repos().campaign.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.delete",
    meta: { campaignId: id, name: campaign.name },
  });
  revalidatePath("/marketing/campaigns");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Audience preview                                                           */
/* -------------------------------------------------------------------------- */

export interface AudiencePreview {
  /** Everyone the rules matched, before any subtraction. The rail shows
   *  the arithmetic rather than hiding it, so this is the starting term. */
  matched: number;
  /** People who would actually be mailed. */
  count: number;
  /** Records dropped for having no email on file. */
  droppedNoEmail: number;
  /** Records dropped because another source already had the address. */
  droppedDuplicate: number;
  /** Matched, but on the do-not-market list. */
  suppressed: number;
  /** First few recipients, so the broker can sanity-check the segment. */
  sample: Array<{
    name: string;
    email: string;
    source: string;
    /** "ANZ · settled Mar 2023" — enough to recognise the segment. */
    context: string;
  }>;
}

/**
 * Count and sample an audience without saving anything. Drives the live
 * "this reaches N people" readout in the editor, so a broker can feel
 * out a segment before committing to it.
 */
export async function previewAudienceAction(
  filter: unknown,
): Promise<Result<{ preview: AudiencePreview }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = AudienceFilterSchema.safeParse(filter);
  if (!parsed.success) {
    return { ok: false, error: "That audience filter isn't valid." };
  }

  const resolved = await resolveFor(parsed.data);
  const suppressed = await repos().campaign.suppressedAmong(
    resolved.members.map((m) => m.email),
  );
  const mailable = resolved.members.filter((m) => !suppressed.has(m.email));

  return {
    ok: true,
    preview: {
      matched:
        resolved.members.length +
        resolved.droppedNoEmail +
        resolved.droppedDuplicate,
      count: mailable.length,
      droppedNoEmail: resolved.droppedNoEmail,
      droppedDuplicate: resolved.droppedDuplicate,
      suppressed: suppressed.size,
      sample: mailable.slice(0, 8).map((m) => ({
        name: m.name,
        email: m.email,
        source: m.sourceKind === "settlements" ? "Back-book" : "Pipeline",
        context: sampleContext(m),
      })),
    },
  };
}

/** The one line under a sample name: enough to recognise which segment
 *  this person came from without opening their record. */
function sampleContext(m: {
  sourceKind: string;
  fields: Record<string, string>;
}): string {
  const parts: string[] = [];
  if (m.fields.lender) parts.push(m.fields.lender);
  if (m.sourceKind === "settlements" && m.fields.settlement_date) {
    // "15 March 2023" → "settled Mar 2023"
    const d = new Date(m.fields.settlement_date);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        `settled ${d.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}`,
      );
    }
  }
  return parts.join(" · ");
}

async function resolveFor(filter: AudienceFilter) {
  const needsTags =
    filter.includeTags.length > 0 || filter.excludeTags.length > 0;
  const [settlements, deals, tagRows] = await Promise.all([
    filter.sources.includes("settlements") ? listSettlements() : [],
    filter.sources.includes("deals")
      ? getSalestrekkerClient().listDeals()
      : [],
    // Only paid for when the filter actually mentions a tag.
    needsTags ? repos().contactTag.list() : [],
  ]);

  const tagsByEmail: Record<string, string[]> = {};
  for (const row of tagRows) {
    (tagsByEmail[row.email] ??= []).push(row.tag);
  }

  /* A follow-up narrows to the people an earlier campaign reached and
     who never opened it. Recomputed on every preview rather than frozen
     at creation, so someone who opens the original tomorrow drops out
     of the follow-up — which is the whole point of sending one. */
  let restrictToEmails: string[] | undefined;
  if (filter.nonOpenersOf) {
    const earlier = await repos().campaign.listRecipients(filter.nonOpenersOf, {
      limit: 20_000,
    });
    restrictToEmails = earlier
      .filter((r) => r.status === "sent" && r.openedAt === null)
      .map((r) => r.email);
  }

  return resolveAudience({
    filter,
    settlements,
    deals,
    tagsByEmail,
    restrictToEmails,
  });
}

/* -------------------------------------------------------------------------- */
/* Test send                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mail one copy to the signed-in broker, merged against the first real
 * recipient the audience produces. Reviewing a preview built from
 * placeholder values is how a broken merge field reaches 400 people —
 * this renders exactly what a customer would receive.
 */
export async function sendTestAction(
  id: string,
): Promise<Result<{ to: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (!campaign.subject.trim() || !campaign.body.trim()) {
    return { ok: false, error: "Write a subject and a body first." };
  }

  const filter = AudienceFilterSchema.parse(campaign.audience);
  const resolved = await resolveFor(filter);
  const standIn: AudienceMember | undefined = resolved.members[0];

  const to = teamMember(auth.brokerId).email;
  if (!to) {
    return { ok: false, error: "Your team profile has no email address." };
  }

  try {
    await sendOneCampaignEmail({
      campaign,
      recipient: {
        email: standIn?.email ?? to,
        name: standIn?.name ?? "Test recipient",
        firstName: standIn?.firstName ?? "there",
        fields: standIn?.fields ?? { first_name: "there" },
        // A test send always shows subject A: the broker is checking
        // the wording, not participating in the experiment.
        variant: "a",
      },
      toOverride: to,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.test.send",
    meta: { campaignId: id, to },
  });
  return { ok: true, to };
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

export interface StartCampaignInput {
  id: string;
  /** ISO datetime to hold until, or null to start now. */
  scheduledFor: string | null;
}

/**
 * Resolve the audience into a fixed recipient list and hand the campaign
 * to the cron.
 *
 * The list is frozen here rather than re-derived at send time: a
 * campaign a broker reviewed on Monday should reach the people they
 * reviewed it against, not whoever happens to match on Thursday.
 */
export async function startCampaignAction(
  input: StartCampaignInput,
): Promise<Result<{ recipients: number; scheduled: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(input.id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (!isEditable(campaign.status as CampaignStatus)) {
    return { ok: false, error: `This campaign is already ${campaign.status}.` };
  }
  if (!campaign.subject.trim() || !campaign.body.trim()) {
    return { ok: false, error: "Write a subject and a body first." };
  }

  // Starting resolves a fresh recipient list, which replaces the old one.
  // On a campaign that has already mailed people that would both lose the
  // record of who received it and send them a second copy — resuming is
  // the path back for those, not sending again.
  const existing = await repos().campaign.stats(campaign.id);
  if (existing.sent > 0) {
    return {
      ok: false,
      error: `This campaign has already gone to ${existing.sent} ${
        existing.sent === 1 ? "person" : "people"
      }. Resume it to send the rest, or copy it into a new campaign.`,
    };
  }

  const badFields = [
    ...unknownMergeFields(campaign.subject, MERGE_FIELDS),
    ...unknownMergeFields(campaign.body, MERGE_FIELDS),
  ];
  if (badFields.length) {
    return {
      ok: false,
      error: `Unknown merge field${badFields.length > 1 ? "s" : ""}: ${badFields
        .map((f) => `{{${f}}}`)
        .join(", ")}. Fix these before sending.`,
    };
  }

  const filter = AudienceFilterSchema.parse(campaign.audience);
  const resolved = await resolveFor(filter);
  const suppressed = await repos().campaign.suppressedAmong(
    resolved.members.map((m) => m.email),
  );
  const mailable = resolved.members.filter((m) => !suppressed.has(m.email));
  if (mailable.length === 0) {
    return { ok: false, error: "This audience reaches nobody." };
  }

  /* A/B assignment happens here, once, at the same moment the audience
     is frozen. Assigning at send time would let a restart reshuffle who
     saw which subject, and the arms would stop meaning anything. */
  const testing = Boolean(campaign.subjectB?.trim());
  const variants = testing
    ? assignVariants(mailable.length, campaign.abTestPercent)
    : mailable.map(() => null);

  const rows: NewCampaignRecipient[] = mailable.map((m, i) => ({
    campaignId: campaign.id,
    email: m.email,
    name: m.name,
    firstName: m.firstName,
    sourceKind: m.sourceKind,
    sourceId: m.sourceId,
    fields: m.fields,
    variant: variants[i],
    // The holdback waits for a winner; everyone else goes now.
    status: testing && variants[i] === null ? "holdback" : "pending",
  }));
  const landed = await repos().campaign.setRecipients(campaign.id, rows);

  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  const scheduled = scheduledFor !== null && scheduledFor > new Date();

  await repos().campaign.update(campaign.id, {
    status: scheduled ? "scheduled" : "sending",
    scheduledFor: scheduled ? scheduledFor : null,
    startedAt: null,
    completedAt: null,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: scheduled ? "campaign.schedule" : "campaign.start",
    meta: {
      campaignId: campaign.id,
      name: campaign.name,
      recipients: landed,
      scheduledFor: scheduledFor?.toISOString() ?? null,
    },
  });

  if (!scheduled) {
    // Send a small first batch straight away so the broker sees movement
    // rather than waiting up to an hour for the cron's first pass. Kept
    // short deliberately: a server action has a far tighter budget than
    // the cron, and the rest of the queue drains hourly anyway.
    const fresh = await repos().campaign.get(campaign.id);
    if (fresh) {
      try {
        await dispatchCampaignBatch(fresh, { batchSize: FIRST_BATCH_SIZE });
      } catch (err) {
        console.error("[campaign] first batch failed", err);
      }
    }
  }

  revalidatePath(`/marketing/campaigns/${campaign.id}`);
  revalidatePath("/marketing/campaigns");
  return { ok: true, recipients: landed, scheduled };
}

/** Stop a send mid-flight. The queue is left intact so it can resume. */
export async function pauseCampaignAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "sending" && campaign.status !== "scheduled") {
    return { ok: false, error: `Nothing to pause — this is ${campaign.status}.` };
  }

  await repos().campaign.update(id, { status: "paused" });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.pause",
    meta: { campaignId: id },
  });
  revalidatePath(`/marketing/campaigns/${id}`);
  return { ok: true };
}

/** Put a paused campaign back in the cron's hands. */
export async function resumeCampaignAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(id);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "paused") {
    return { ok: false, error: "Only a paused campaign can resume." };
  }

  await repos().campaign.update(id, { status: "sending", scheduledFor: null });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.resume",
    meta: { campaignId: id },
  });
  revalidatePath(`/marketing/campaigns/${id}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Suppression list                                                           */
/* -------------------------------------------------------------------------- */

/** Add someone by hand — for the opt-outs that arrive by phone or reply
 *  rather than through the unsubscribe link. */
export async function suppressEmailAction(email: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  await repos().campaign.suppress({
    email: trimmed,
    reason: "manual",
    addedBy: auth.brokerId,
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.suppress.manual",
    meta: { email: trimmed },
  });
  revalidatePath("/marketing/suppressions");
  return { ok: true };
}

/**
 * Add several addresses at once — the bulk action on the subscriber
 * list, for when a whole cohort asks off after a call round.
 *
 * Returns void rather than a result because the caller is a bulk button:
 * a partial failure is logged and the page refresh shows what actually
 * landed, which is more honest than a summary count that might not match
 * the register.
 */
export async function suppressManyAction(emails: string[]): Promise<void> {
  const auth = await requireAdmin();
  if (!auth.ok) return;

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@")) continue;
    try {
      await repos().campaign.suppress({
        email,
        reason: "manual",
        addedBy: auth.brokerId,
      });
    } catch (err) {
      console.error(`[campaign] bulk suppress failed for ${email}`, err);
    }
  }

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.suppress.bulk",
    meta: { count: emails.length },
  });
  revalidatePath("/marketing/subscribers");
  revalidatePath("/marketing/suppressions");
}

/** Take someone off the do-not-market list — only ever on their own
 *  request, which is why it is audited by name. */
export async function unsuppressEmailAction(email: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  await repos().campaign.unsuppress(email);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.unsuppress",
    meta: { email: email.toLowerCase() },
  });
  revalidatePath("/marketing/suppressions");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Saved segments                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Save the campaign's current audience as a named segment.
 *
 * The filter is copied out of the campaign, not linked to it. A segment
 * is a definition the firm reuses; a campaign's audience is a decision
 * already made. Linking them would let an edit to the segment change
 * who a scheduled campaign mails tonight.
 */
export async function saveSegmentAction(args: {
  name: string;
  description: string;
  filter: unknown;
}): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const name = args.name.trim();
  if (!name) return { ok: false, error: "Give the segment a name." };

  const parsed = AudienceFilterSchema.safeParse(args.filter);
  if (!parsed.success) {
    return { ok: false, error: "That audience could not be read." };
  }

  /* Names are unique, and a broker re-saving under an existing name
     means "update it" rather than "fail". Matched case-insensitively so
     "Investors" and "investors" cannot both exist and diverge. */
  const existing = (await repos().segment.list()).find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    await repos().segment.update(existing.id, {
      name,
      description: args.description.trim(),
      filter: parsed.data,
    });
    await auditLog({
      actor: { type: "broker", id: auth.brokerId },
      action: "segment.update",
      meta: { segmentId: existing.id, name },
    });
    revalidatePath("/marketing/campaigns");
    return { ok: true, id: existing.id };
  }

  const created = await repos().segment.create({
    name,
    description: args.description.trim(),
    filter: parsed.data,
    createdBy: auth.brokerId,
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "segment.create",
    meta: { segmentId: created.id, name },
  });
  revalidatePath("/marketing/campaigns");
  return { ok: true, id: created.id };
}

export async function deleteSegmentAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const existing = await repos().segment.get(id);
  if (!existing) return { ok: true };

  await repos().segment.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "segment.delete",
    meta: { segmentId: id, name: existing.name },
  });
  revalidatePath("/marketing/campaigns");
  return { ok: true };
}

/**
 * How many contacts a saved segment resolves to right now.
 *
 * Recomputed on request rather than stored, because that is the whole
 * point of a segment: the answer is meant to change as the book does.
 */
export async function segmentReachAction(
  id: string,
): Promise<Result<{ count: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const segment = await repos().segment.get(id);
  if (!segment) return { ok: false, error: "That segment no longer exists." };

  const parsed = AudienceFilterSchema.safeParse(segment.filter);
  if (!parsed.success) {
    return { ok: false, error: "That segment could not be read." };
  }

  const resolved = await resolveFor(parsed.data);
  return { ok: true, count: resolved.members.length };
}

/* -------------------------------------------------------------------------- */
/* Follow-up                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Start a follow-up to the people who never opened a campaign.
 *
 * The body is copied and the subject is left blank on purpose. Resending
 * the same subject to someone who already ignored it once is the most
 * common way this feature gets misused — the subject is the thing that
 * failed, so it is the thing to change.
 */
export async function followUpNonOpenersAction(
  campaignId: string,
): Promise<Result<{ id: string; reach: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const original = await repos().campaign.get(campaignId);
  if (!original) return { ok: false, error: "That campaign no longer exists." };
  if (original.status !== "sent") {
    return {
      ok: false,
      error: "Wait until the campaign has finished sending.",
    };
  }

  const filter: AudienceFilter = {
    ...AudienceFilterSchema.parse(original.audience),
    nonOpenersOf: original.id,
  };

  const resolved = await resolveFor(filter);
  if (resolved.members.length === 0) {
    return {
      ok: false,
      error: "Everyone who received that campaign has opened it.",
    };
  }

  const campaign = await repos().campaign.create({
    name: `${original.name} — follow-up`,
    subject: "",
    body: original.body,
    status: "draft",
    audience: filter,
    fromBrokerId: original.fromBrokerId,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.followup.create",
    meta: {
      campaignId: campaign.id,
      followingUp: original.id,
      reach: resolved.members.length,
    },
  });
  revalidatePath("/marketing/campaigns");
  return { ok: true, id: campaign.id, reach: resolved.members.length };
}

import "server-only";
import type { Deal } from "@/lib/clients/salestrekker/types";
import type { TeamMemberId } from "@/lib/team";
import {
  composeFollowUp,
  composePreApprovalRenewal,
  contextForDeal,
} from "@/lib/email-templates";
import { portalUrlForDeal } from "@/lib/portal-link";
import { followUpCcList, mailtoRecipients } from "@/lib/support-cc";

/**
 * Follow-up deck candidates.
 *
 * The same shape as EOD briefs but driven by "this deal needs a chase"
 * rather than "summarise this deal at end of day". Eligible deals are:
 *
 *  - Owned by the current broker (broker or supporting associate).
 *  - Active pipeline (not settled, not nurtured).
 *  - Have either overdue docs OR daysSinceContact >= 3.
 *  - Have a customer email on file for deck cards (the count badge
 *    includes email-less deals too, since they still need a phone call).
 *
 * Each candidate is pre-drafted with the existing composeFollowUp
 * template engine so the deck can show the subject + body without a
 * second server round-trip. Skip is local-only (ephemeral), Send opens
 * an Outlook draft via mailto: which fires the desktop client's
 * compose window with subject + body populated.
 */

export interface FollowUpCard {
  /** Deterministic id so the deck can survive re-renders. */
  id: string;
  dealId: string;
  dealName: string;
  dealRef: string;
  /** Customer email - we filter candidates without one out before they
   *  reach this shape, so this is always present. */
  customerEmail: string;
  subject: string;
  /** Plain-text body the mailto draft will load. Same content the
   *  Composer would generate for tone="warm". */
  body: string;
  /** Pre-built mailto URL ready to window.open. The desktop Outlook
   *  picks this up and opens a compose window with everything filled. */
  mailtoUrl: string;
  /** Short "why this is up next" line shown on the card. */
  reason: string;
  /** Drives the order - higher = more urgent. */
  score: number;
}

/** Convert calendar days since contact into business days. Pure -
 *  uses today's date to walk backwards N calendar days and count
 *  Mon-Fri days strictly between (last contact, today].
 *
 *  Examples:
 *   - Today is Wed, daysSince = 2 -> last contact was Mon
 *     -> Tue, Wed are BDs -> 2 BD elapsed -> chase fires
 *   - Today is Mon, daysSince = 3 -> last contact was Fri
 *     -> only Mon counts (Sat/Sun skipped) -> 1 BD elapsed
 *     -> doesn't fire yet, broker has the morning to catch up
 *   - Today is Tue, daysSince = 4 -> last contact was Fri
 *     -> Mon + Tue = 2 BD elapsed -> fires
 *
 *  Today's date is sampled inside the function so it always uses
 *  the live wall clock - safe because the function is only called
 *  during request-scoped server rendering. */
export function businessDaysSinceContact(daysSince: number): number {
  if (daysSince <= 0) return 0;
  const today = new Date();
  const lastContact = new Date(today);
  lastContact.setDate(today.getDate() - daysSince);
  let count = 0;
  const cursor = new Date(lastContact);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= today) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Fast eligibility check shared by the count path and the build
 *  path. Doesn't touch templates - just the deal shape.
 *
 *  Trigger rules (first match wins):
 *    1. Pre-approval expired or expires within 21 days.
 *    2. Broker explicitly flagged the deal ("Follow Up" / "Outstanding Action"
 *       stage label in the pipeline spreadsheet).
 *    3. Any doc is overdue — surfaces immediately regardless of elapsed time.
 *    4. Pending docs exist AND the deal has been in the same stage for 2+
 *       calendar days — broker should be chasing for the outstanding docs.
 *    5. No portal configured at all AND at least 1 day has passed — deal
 *       needs initial outreach before anything can progress.
 *
 *  Note: does NOT require a customer email — deals without email still
 *  count toward the badge. The deck builder filters email-less deals
 *  out separately because it needs a valid mailto address. */
function isFollowUpCandidate(deal: Deal, brokerId: TeamMemberId): boolean {
  if (deal.stageId === "settled") return false;
  if (deal.nurturedAt !== null) return false;
  if (deal.brokerId !== brokerId && deal.associateId !== brokerId) return false;

  /* 0. Chased today already? Rest it. A follow-up sent today (from the
     deck via logFollowUpSentAction, or the composer via sendFollowUp)
     sets lastContactAt=now, so daysSinceContact recomputes to 0. Don't
     re-surface the same deal in the queue until at least tomorrow.
     Guarded on lastContactAt so a never-contacted deal still gets
     outreach — daysSinceContact alone can be 0 on a fresh import. */
  if (deal.lastContactAt && deal.daysSinceContact === 0) return false;

  /* 1. Pre-approval expired or expiring within 21 days. */
  if (deal.preApprovalExpiry) {
    const daysToExpiry = Math.ceil(
      (new Date(deal.preApprovalExpiry).getTime() - Date.now()) / 86400_000,
    );
    if (daysToExpiry <= 21) return true;
  }

  /* 2. Broker explicitly flagged this deal. */
  if (deal.priorityFlag === "follow-up" || deal.priorityFlag === "outstanding-action") {
    return true;
  }

  /* 3. Any doc overdue — immediate. */
  if (deal.overdue.length > 0) return true;

  /* 4. Pending docs + 2+ calendar days in the same stage. */
  if (deal.pending.length > 0 && deal.daysSinceContact >= 2) return true;

  /* 5. No portal at all — needs initial outreach after 1 day. */
  const noDocs =
    deal.pending.length === 0 &&
    deal.overdue.length === 0 &&
    deal.received.length === 0;
  if (noDocs && deal.daysSinceContact >= 1) return true;

  return false;
}

/** Cheap candidate count - just a filter, no template rendering.
 *  Safe to call on every page render. Drives the header badge. */
export function countFollowUpCandidates(
  deals: Deal[],
  brokerId: TeamMemberId,
): number {
  let n = 0;
  for (const deal of deals) if (isFollowUpCandidate(deal, brokerId)) n++;
  return n;
}

/** Build the full deck WITH drafted emails. EXPENSIVE - each candidate
 *  triggers a composeFollowUp template render. Call this lazily, only
 *  when the broker actually opens the deck (e.g. from a server action
 *  fired on click), never eagerly during page render. */
export async function buildFollowUpDeck(
  deals: Deal[],
  brokerId: TeamMemberId,
): Promise<FollowUpCard[]> {
  const cards: FollowUpCard[] = [];
  for (const deal of deals) {
    if (!isFollowUpCandidate(deal, brokerId)) continue;
    if (!deal.email) continue; // deck cards need a mailto address; email-less deals count in the badge but skip the draft

    /* Pre-approval renewal takes priority over the standard follow-up
       template when the PA has expired or expires within 21 days. */
    const paExpiry = deal.preApprovalExpiry;
    const daysToExpiry = paExpiry
      ? Math.ceil((new Date(paExpiry).getTime() - Date.now()) / 86400_000)
      : Infinity;
    const isPaRenewal = paExpiry !== null && daysToExpiry <= 21;

    /* Mint the customer's secure upload link for any chase that asks for
       documents — outstanding items, or a PA renewal (which requests a
       fresh doc set). Stateless JWT (no DB write); a failure must never
       drop the card. */
    let portalUrl: string | undefined;
    if (deal.pending.length > 0 || deal.overdue.length > 0 || isPaRenewal) {
      portalUrl = await portalUrlForDeal(deal, brokerId).catch(() => undefined);
    }
    const ctx = { ...contextForDeal(deal), portalUrl };

    const draft = isPaRenewal
      ? composePreApprovalRenewal({ ...ctx, expiryDate: paExpiry!, portalUrl })
      : composeFollowUp("warm", ctx);

    const isOverdue = deal.overdue.length > 0;
    const days = deal.daysSinceContact;
    const outstanding = deal.pending.length + deal.overdue.length;
    const noDocs =
      deal.pending.length === 0 &&
      deal.overdue.length === 0 &&
      deal.received.length === 0;

    const isPriorityFlagged =
      deal.priorityFlag === "follow-up" ||
      deal.priorityFlag === "outstanding-action";

    const reason = isPaRenewal
      ? daysToExpiry <= 0
        ? `Pre-approval expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? "" : "s"} ago — renewal documents needed`
        : `Pre-approval expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"} — start renewal now`
      : deal.priorityFlag === "outstanding-action"
        ? `Outstanding action flagged in pipeline${isOverdue ? ` · ${deal.overdue.length} overdue ${deal.overdue.length === 1 ? "doc" : "docs"}` : ""}`
        : isPriorityFlagged
          ? `Flagged for follow-up in pipeline${isOverdue ? ` · ${deal.overdue.length} overdue ${deal.overdue.length === 1 ? "doc" : "docs"}` : ""}`
          : isOverdue
            ? `${deal.overdue.length} overdue ${deal.overdue.length === 1 ? "doc" : "docs"} · ${days} ${days === 1 ? "day" : "days"} in current stage`
            : noDocs
              ? `${days} ${days === 1 ? "day" : "days"} in current stage · no portal set up yet`
              : `${days} ${days === 1 ? "day" : "days"} in current stage · ${outstanding} ${outstanding === 1 ? "doc" : "docs"} outstanding`;

    /* Expired PA > approaching PA > outstanding-action flag > follow-up flag > overdue > pending. */
    const score = isPaRenewal
      ? daysToExpiry <= 0
        ? 950 + Math.abs(daysToExpiry) * 5
        : 880 - daysToExpiry * 5
      : deal.priorityFlag === "outstanding-action"
        ? 800 + deal.overdue.length * 10
        : isPriorityFlagged
          ? 700 + deal.overdue.length * 10
          : isOverdue
            ? 500 + deal.overdue.length * 20 + days * 2
            : 100 + days * 5;

    cards.push({
      id: `fu-${deal.id}`,
      dealId: deal.id,
      dealName: deal.name,
      dealRef: deal.appRef,
      customerEmail: deal.email!,
      subject: draft.subject,
      body: draft.body,
      mailtoUrl: buildMailtoUrl(deal.email!, draft.subject, draft.body, followUpCcList(deal.email!)),
      reason,
      score,
    });
  }
  /* Stable sort by score desc - most urgent first so the broker
     starts with the deals that have been quiet longest. */
  cards.sort((a, b) => b.score - a.score);
  return cards;
}

/** RFC 6068 mailto: builder. Subject and body must be percent-encoded;
 *  newlines come through as %0A and Outlook renders them as line breaks
 *  in the compose window. */
function buildMailtoUrl(
  to: string,
  subject: string,
  body: string,
  cc: string[],
): string {
  const qs = new URLSearchParams();
  if (cc.length) qs.set("cc", mailtoRecipients(cc));
  qs.set("subject", subject);
  qs.set("body", body);
  /* URLSearchParams uses + for spaces, mailto expects %20. Swap them
     so Outlook desktop doesn't render literal plus signs in subjects
     ("Need+a+sec+to+chase"). */
  const query = qs.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(to)}?${query}`;
}

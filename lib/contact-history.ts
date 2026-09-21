import "server-only";
import { repos } from "@/lib/db/repos";
import { teamMember } from "@/lib/team";
import type { AuditLogRow } from "@/lib/db/schema";

/**
 * Per-deal / per-settlement contact history.
 *
 * Every customer-facing send in LoanFlow already writes an audit_log row
 * (composer emails + SMS, welcome/portal-link emails, portal reminders,
 * CX review emails). This reads those rows back and normalises them into
 * a single timeline the "Contact history" dialog renders.
 *
 * Pipeline sends carry a dealId, so the deal drawer queries by dealId.
 * CX review sends carry a settlementId in their meta (not a dealId), so
 * the CX Manager rows query by settlementId. Either way the customer sees
 * the same shape.
 */

export interface ContactEntry {
  id: string;
  /** ISO timestamp of the send. */
  at: string;
  channel: "email" | "sms" | "other";
  /** Friendly label, e.g. "Follow-up email", "CX review email". */
  kind: string;
  /** Recipient address / number, when the audit row captured it. */
  to: string;
  /** Subject line, when captured. */
  subject: string | null;
  /** Who sent it: a team member's name, "System", or "Customer". */
  sentBy: string;
  status: "sent" | "failed" | "skipped";
}

interface SendMeta {
  channel: "email" | "sms" | "other";
  kind: string;
  status: "sent" | "failed" | "skipped";
}

/**
 * Audit actions that represent an actual outbound contact TO the customer.
 * Broker-facing notifications (portal.upload.notify.*), OTP codes, test
 * sends and run summaries are deliberately excluded — they aren't the
 * relationship touchpoints the broker means by "contact history".
 */
const SEND_MAP: Record<string, SendMeta> = {
  "dashboard.outlook.send": { channel: "email", kind: "Email", status: "sent" },
  "dashboard.outlook.send.failed": { channel: "email", kind: "Email", status: "failed" },
  "dashboard.composer.send.sms": { channel: "sms", kind: "SMS follow-up", status: "sent" },
  "dashboard.deal.create.email.sent": { channel: "email", kind: "Welcome + portal link", status: "sent" },
  "dashboard.deal.create.email.failed": { channel: "email", kind: "Welcome + portal link", status: "failed" },
  "cx.review.send": { channel: "email", kind: "CX review email", status: "sent" },
  "cx.review.send.failed": { channel: "email", kind: "CX review email", status: "failed" },
  "cron.portal_reminder.day3.sent": { channel: "sms", kind: "Portal reminder (day 3)", status: "sent" },
  "cron.portal_reminder.day7.sent": { channel: "sms", kind: "Portal reminder (day 7)", status: "sent" },
  "cron.portal_reminder.email.sent": { channel: "email", kind: "Portal reminder email", status: "sent" },
};

/** Give a broker email a more specific label from its composer source. */
const SOURCE_KIND: Record<string, string> = {
  composer: "Follow-up email",
  handover: "Handover email",
  "post-settlement": "Post-settlement email",
};

function actorLabel(row: AuditLogRow): string {
  if (row.actorType === "system") return "System";
  if (row.actorType === "customer") return "Customer";
  // Broker / staff: resolve the team id to a name, fall back to the id.
  const m = teamMember(row.actorId);
  return m?.name ?? row.actorId;
}

function toEntry(row: AuditLogRow): ContactEntry | null {
  const map = SEND_MAP[row.action];
  if (!map) return null;
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const source = typeof meta.source === "string" ? meta.source : "";
  const kind =
    row.action === "dashboard.outlook.send" && SOURCE_KIND[source]
      ? SOURCE_KIND[source]
      : map.kind;
  const at =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString();
  return {
    id: row.id,
    at,
    channel: map.channel,
    kind,
    to: typeof meta.to === "string" ? meta.to : "",
    subject: typeof meta.subject === "string" ? meta.subject : null,
    sentBy: actorLabel(row),
    status: map.status,
  };
}

export async function getContactHistory(input: {
  dealId?: string;
  settlementId?: string;
}): Promise<ContactEntry[]> {
  const audit = repos().audit;
  let rows: AuditLogRow[] = [];

  if (input.dealId) {
    rows = await audit.list({ dealId: input.dealId, limit: 300 });
  } else if (input.settlementId) {
    // CX review sends store the settlement id in meta, not as a column, so
    // pull the review-send actions and filter in memory.
    const cxActions = ["cx.review.send", "cx.review.send.failed"];
    const lists = await Promise.all(
      cxActions.map((a) => audit.list({ action: a, limit: 1000 })),
    );
    rows = lists
      .flat()
      .filter(
        (r) =>
          String((r.meta as Record<string, unknown> | null)?.settlementId ?? "") ===
          input.settlementId,
      );
  }

  return rows
    .map(toEntry)
    .filter((e): e is ContactEntry => e !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
}

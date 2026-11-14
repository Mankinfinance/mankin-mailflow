import { NextResponse } from "next/server";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { auditLog } from "@/lib/audit";
import { repos } from "@/lib/db/repos";
import { listSettlements } from "@/lib/settlements-store";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import { buildSubscribers } from "@/lib/campaigns/subscribers";
import { teamMember } from "@/lib/team";
import { toCsv } from "@/lib/csv";
import { unsubscribeReasonLabel } from "@/lib/campaigns/unsubscribe-reasons";

/**
 * CSV exports: the subscriber list, the do-not-market register, and one
 * campaign's per-recipient results.
 *
 * Each holds clients' personal details, so: admin only, never cached,
 * and every download is in the audit log with who took it and how many
 * rows. The register export is also the evidence, if anyone asks, of
 * who opted out and when.
 */

export const dynamic = "force-dynamic";

function csvResponse(name: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  const { kind } = await params;

  if (kind === "subscribers") {
    const [settlements, deals, suppressions, tagRows] = await Promise.all([
      listSettlements(),
      getSalestrekkerClient().listDeals(),
      repos().campaign.listSuppressions(100_000),
      repos().contactTag.list(),
    ]);
    const tags = new Map<string, string[]>();
    for (const row of tagRows) tags.set(row.email, [...(tags.get(row.email) ?? []), row.tag]);
    const subscribers = buildSubscribers({ settlements, deals, suppressions });
    const rows = subscribers.map((s) => [
      s.email,
      s.name,
      s.source === "back-book" ? "Back-book" : "Pipeline",
      s.status,
      s.since,
      teamMember(s.brokerId)?.name ?? s.brokerId,
      s.loan.lender,
      s.loan.settledOn,
      s.loan.loanAmount,
      s.loan.currentBalance,
      s.loan.loanStatus,
      s.loan.stageId,
      (tags.get(s.email) ?? []).sort().join("; "),
    ]);
    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "export.subscribers",
      meta: { rows: rows.length },
    });
    return csvResponse(
      `mailflow-subscribers-${day()}.csv`,
      toCsv(
        ["Email", "Name", "Source", "Status", "Since", "Broker", "Lender", "Settled", "Loan amount", "Current balance", "Loan status", "Pipeline stage", "Tags"],
        rows,
      ),
    );
  }

  if (kind === "suppressions") {
    const [rows, campaigns] = await Promise.all([
      repos().campaign.listSuppressions(100_000),
      repos().campaign.list(),
    ]);
    const names = new Map(campaigns.map((c) => [c.id, c.name]));
    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "export.suppressions",
      meta: { rows: rows.length },
    });
    return csvResponse(
      `mailflow-do-not-market-${day()}.csv`,
      toCsv(
        ["Email", "How they came off", "Date", "Added by", "Campaign", "Why (if they said)", "In their words"],
        rows.map((r) => [
          r.email,
          r.reason === "bounce" ? "Bounce" : r.reason === "manual" ? "Added by hand" : "Unsubscribe",
          r.createdAt,
          r.addedBy === "customer" ? "The client" : r.addedBy === "system" ? "Mailflow" : (teamMember(r.addedBy)?.name ?? r.addedBy),
          r.campaignId ? (names.get(r.campaignId) ?? r.campaignId) : "",
          unsubscribeReasonLabel(r.feedback),
          r.feedbackNote ?? "",
        ]),
      ),
    );
  }

  if (kind === "campaign") {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const campaign = id ? await repos().campaign.get(id).catch(() => null) : null;
    if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
    const recipients = await repos().campaign.listRecipients(campaign.id, { limit: 100_000 });
    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "export.campaign",
      meta: { campaignId: campaign.id, rows: recipients.length },
    });
    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "campaign";
    return csvResponse(
      `mailflow-${slug}-${day()}.csv`,
      toCsv(
        ["Email", "Name", "Subject version", "Status", "Sent", "Opened", "Clicked", "Unsubscribed", "Problem"],
        recipients.map((r) => [
          r.email,
          r.name,
          r.variant ? r.variant.toUpperCase() : "",
          r.status,
          r.sentAt,
          r.openedAt,
          r.clickedAt,
          r.unsubscribedAt,
          r.error ?? r.skipReason ?? "",
        ]),
      ),
    );
  }

  return NextResponse.json({ ok: false, error: "Unknown export." }, { status: 404 });
}

import { NextResponse } from "next/server";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { verifyTrackingToken } from "@/lib/campaigns/tracking";

/**
 * One-click unsubscribe (RFC 8058).
 *
 * This is the endpoint named in the `List-Unsubscribe` header, and it
 * is what Gmail and Yahoo POST to when someone uses the unsubscribe
 * button in the mail client's own chrome rather than the link in the
 * body.
 *
 * It acts immediately, with no confirmation step. That is the opposite
 * of the browser-facing page at /e/u/[token], and both are correct: a
 * scanner following a link in an email must not opt anyone out, but a
 * POST carrying `List-Unsubscribe=One-Click` is an explicit,
 * deliberate action a person just took in their mail client. Making
 * them confirm would breach the spec, and providers check.
 *
 * Always answers 200. A mail provider that gets an error here may
 * decide our unsubscribe mechanism is broken, which is worse for
 * placement than the failure it is reporting.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const verified = await verifyTrackingToken(token, "unsubscribe");
    if (!verified.ok) return NextResponse.json({ ok: true });

    const { cid, em } = verified.claims;
    await repos().campaign.suppress({
      email: em,
      reason: "unsubscribe",
      campaignId: cid,
      addedBy: "customer",
    });

    const recipient = await repos().campaign.findRecipient(cid, em);
    if (recipient && recipient.unsubscribedAt === null) {
      await repos().campaign.updateRecipient(recipient.id, {
        unsubscribedAt: new Date(),
      });
    }

    await auditLog({
      actor: { type: "system" },
      action: "campaign.unsubscribe.one_click",
      meta: { campaignId: cid, email: em },
    });
  } catch (err) {
    console.error("[one-click unsubscribe] failed", err);
  }

  return NextResponse.json({ ok: true });
}

/** Some providers probe with GET before POSTing. Answer, but never act
 *  on a GET — that is the scanner problem the confirm page exists for. */
export async function GET() {
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { verifyTrackingToken } from "@/lib/campaigns/tracking";
import { recordUnsubscribe } from "@/lib/campaigns/unsubscribe";

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
    /* The same function the confirm page uses. This route used to do
       its own thing and never emitted contact.unsubscribed, so an
       opt-out through the mail client's own button reached no other
       system. */
    await recordUnsubscribe({ cid, email: em, via: "one-click" });
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

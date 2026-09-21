import { redirect } from "next/navigation";
import { repos } from "@/lib/db/repos";
import {
  safeRedirectTarget,
  verifyTrackingToken,
} from "@/lib/campaigns/tracking";
import { portalBaseUrl } from "@/lib/portal-link";

/**
 * Click redirect. Every link in a campaign body is rewritten to point
 * here, carrying its real destination in `?u=`; we record the click and
 * forward.
 *
 * The destination is only honoured for a token that actually carries
 * our signature. `?u=` is attacker-controlled — this route is public,
 * and `safeRedirectTarget` restricts the scheme but not the host — so
 * forwarding before checking the token would make the firm's own domain
 * a redirector into anyone's phishing page. A customer who has been
 * told to only click mankinfinance.com links is exactly who that
 * defeats.
 *
 * An expired token still forwards. jose verifies the signature before
 * it looks at `exp`, so "expired" means the link is genuinely ours and
 * merely old, and someone opening a year-old email should still land
 * where it promised. A missing, forged or malformed token goes to the
 * site root instead.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const url = new URL(req.url);
  const target = safeRedirectTarget(url.searchParams.get("u"));

  /* Set only once the token proves authentic, so every path that
     reaches the redirect below has been through verification. */
  let destination: string | null = null;

  try {
    const { token } = await params;
    const verified = await verifyTrackingToken(token, "click");

    if (verified.ok || verified.reason === "expired") {
      destination = target;
    }

    if (verified.ok) {
      const { cid, em } = verified.claims;
      // Which link, not just that there was one — the report's link
      // table is the difference between "17% clicked" and "17% clicked
      // the booking link".
      if (target) {
        await repos().campaign.recordLinkClick(cid, target);
      }
      const recipient = await repos().campaign.findRecipient(cid, em);
      if (recipient) {
        const now = new Date();
        await repos().campaign.updateRecipient(recipient.id, {
          clickedAt: recipient.clickedAt ?? now,
          // A click proves the email was opened, whatever the pixel did
          // or didn't manage to report.
          openedAt: recipient.openedAt ?? now,
        });
      }
    }
  } catch (err) {
    console.error("[campaign click] failed to record", err);
  }

  redirect(destination ?? portalBaseUrl());
}

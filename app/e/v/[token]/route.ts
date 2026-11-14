import { repos } from "@/lib/db/repos";
import { subjectFor } from "@/lib/campaigns/ab-test";
import { renderCampaign } from "@/lib/campaigns/merge";
import { buildRecipientLinks, verifyTrackingToken } from "@/lib/campaigns/tracking";
import { campaignIdOf, findTrackedMessage, parseTrackingId } from "@/lib/campaigns/tracked-message";
import { currentSettings } from "@/lib/mailflow/current-settings";

/**
 * "View this email in your browser."
 *
 * The link is signed for one recipient of one campaign, so the page is
 * that person's own copy - their name, their broker, their unsubscribe
 * link - and nobody can reach anyone else's by changing the address.
 *
 * An expired link still shows the email: jose checks the signature
 * before the expiry, so "expired" means the link is genuinely ours and
 * merely old, and the email it belongs to is in their inbox anyway.
 *
 * Served with a strict Content-Security-Policy: the page is only the
 * rendered email (escaped by the renderer), so nothing on it needs to
 * run script or load anything but images.
 */

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // One person's copy: never cached anywhere shared, never indexed.
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function page(title: string, inner: string, status = 200): Response {
  const safeTitle = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${safeTitle}</title></head><body style="margin:0;padding:24px 16px;background:#f7f4ee;"><div style="max-width:680px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px;">${inner}</div></body></html>`,
    { status, headers: HEADERS },
  );
}

const gone = () =>
  page(
    "Mankin Finance",
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#22253a;">This email is no longer available. If you need it, reply to the email it came in and we'll send it again.</p>`,
    404,
  );

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const verified = await verifyTrackingToken(token, "view");
    let claims: { cid: string; em: string } | null = null;
    if (verified.ok) claims = verified.claims;
    else if (verified.reason === "expired") {
      // Signature checked; only the age failed. Read the claims anyway.
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as { cid?: string; em?: string; p?: string };
      if (payload.p === "view" && payload.cid && payload.em) {
        claims = { cid: payload.cid, em: payload.em };
      }
    }
    if (!claims) return gone();

    const campaignId = campaignIdOf(parseTrackingId(claims.cid));
    if (!campaignId) return gone();
    const [campaign, recipient] = await Promise.all([
      repos().campaign.get(campaignId),
      repos().campaign.findRecipient(campaignId, claims.em),
    ]);
    if (!campaign || !recipient) return gone();

    const settings = await currentSettings();
    const links = await buildRecipientLinks({
      campaignId: campaign.id,
      email: recipient.email,
      // Viewing is counted below, directly; no pixel needed.
      trackOpens: false,
      trackClicks: campaign.trackClicks,
    });
    const rendered = renderCampaign({
      subject: subjectFor(campaign, recipient.variant),
      body: campaign.body,
      fields: recipient.fields ?? {},
      brokerId: campaign.fromBrokerId,
      links,
      postalAddress: settings.postalAddress,
      signature: settings.signature,
    });

    /* Opening the web version is reading the email. */
    try {
      const message = await findTrackedMessage(claims.cid, claims.em);
      if (message && message.openedAt === null) await message.record({ openedAt: new Date() });
    } catch (err) {
      console.error("[web version] could not record the open", err);
    }

    return page(rendered.subject || "Mankin Finance", rendered.html);
  } catch (err) {
    console.error("[web version] failed", err);
    return gone();
  }
}

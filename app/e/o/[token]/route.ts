import { findTrackedMessage } from "@/lib/campaigns/tracked-message";
import { verifyTrackingToken } from "@/lib/campaigns/tracking";

/**
 * Open-tracking pixel. The campaign renderer drops a 1x1 image at the
 * bottom of the HTML body; the customer's mail client fetching it is
 * what marks the email opened.
 *
 * Always returns the image, whatever happens behind it. A broken token,
 * a deleted campaign or a database blip must not leave a broken-image
 * icon in a customer's email — the tracking is ours to lose, not theirs
 * to see. Opens are recorded once (first open wins) so the count reads
 * as "people who opened", not "times opened".
 *
 * Worth knowing when reading the numbers: Apple Mail Privacy Protection
 * and most corporate scanners pre-fetch images, so opens run high and
 * clicks are the more honest signal.
 */

/** 1x1 transparent GIF. */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse(): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // Never let a proxy serve the pixel from cache — a cached hit is
      // an open we never hear about.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const verified = await verifyTrackingToken(token, "open");
    if (verified.ok) {
      const { cid, em } = verified.claims;
      /* Campaign or automation — the shared lookup knows both. This
         used to ask for a campaign recipient only, so opens in
         automation emails were never recorded. */
      const message = await findTrackedMessage(cid, em);
      if (message && message.openedAt === null) {
        await message.record({ openedAt: new Date() });
      }
    }
  } catch (err) {
    console.error("[campaign open] failed to record", err);
  }
  return pixelResponse();
}

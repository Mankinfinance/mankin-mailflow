import { NextResponse } from "next/server";
import { diagnosticAuthorised } from "@/lib/diagnostic-access";

/**
 * Broker-only diagnostic: tests the Graph app-only mail pipeline end-to-end.
 * Sends a real test email to michael@mankinfinance.com and returns the full
 * result (or error) so we can see exactly what Graph is rejecting.
 *
 * Hit GET /api/health/graph-test?token=... to run the test. Because it sends
 * a real email and discloses Graph token metadata, it is gated behind
 * HEALTH_DIAGNOSTIC_TOKEN and does not rely on the deployment URL being
 * auth-gated. Do not expose to customers.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!diagnosticAuthorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const steps: Record<string, unknown> = {};

  // Step 1: token acquisition — always bypass the in-process cache so this
  // endpoint reflects current Entra permissions, not a 50-min-old grant.
  let token: string;
  try {
    const { _resetGraphTokenCacheForTests, getGraphAppToken } = await import("@/lib/clients/graph-token");
    _resetGraphTokenCacheForTests();
    token = await getGraphAppToken();
    // Decode the JWT payload (middle segment) to show which roles/permissions
    // are actually embedded in the token — this tells us if Mail.Send Application
    // permission made it into the access token or if the wrong app was modified.
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      steps.graphToken = {
        ok: true,
        appId: payload.appid ?? payload.azp,
        roles: payload.roles ?? [],
        scp: payload.scp ?? null,
      };
    } catch {
      steps.graphToken = { ok: true, roles: "(could not decode)" };
    }
  } catch (err) {
    steps.graphToken = { ok: false, error: err instanceof Error ? err.message : String(err) };
    return NextResponse.json({ ok: false, steps }, { status: 200 });
  }

  // Step 2: actually attempt to send a test email. This is the only reliable
  // way to verify Mail.Send is granted — Graph issues tokens regardless of
  // what permissions the app has; the 403 only appears at the API call.
  const from = "michael@mankinfinance.com";
  const payload = {
    message: {
      subject: "[Mailflow diagnostic] Graph mail test",
      body: {
        contentType: "Text",
        content:
          "This is an automated test from the Mailflow /api/health/graph-test endpoint.\n\n" +
          "If you received this, Graph app-only Mail.Send is working correctly.\n\n" +
          `Timestamp: ${new Date().toISOString()}`,
      },
      toRecipients: [{ emailAddress: { address: from } }],
    },
    saveToSentItems: false,
  };

  try {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      steps.mailSend = { ok: false, status: resp.status, body };
      return NextResponse.json({ ok: false, steps }, { status: 200 });
    }

    steps.mailSend = { ok: true, status: resp.status };
  } catch (err) {
    steps.mailSend = { ok: false, error: err instanceof Error ? err.message : String(err) };
    return NextResponse.json({ ok: false, steps }, { status: 200 });
  }

  return NextResponse.json({ ok: true, steps }, { status: 200 });
}

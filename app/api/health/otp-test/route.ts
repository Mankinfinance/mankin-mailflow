import { NextResponse } from "next/server";
import { diagnosticAuthorised } from "@/lib/diagnostic-access";

/**
 * OTP channel diagnostic. Tests every layer of the SMS and email OTP
 * pipeline and returns a plain-English verdict for each so it's obvious
 * what is broken and what to fix.
 *
 * GET /api/health/otp-test?token=...
 *
 * Does NOT send a real SMS or email — only probes credentials and the
 * Graph token. Gated behind HEALTH_DIAGNOSTIC_TOKEN because it discloses
 * credential state and Graph token metadata.
 */

export const dynamic = "force-dynamic";

function present(v: string | undefined): boolean {
  return Boolean(v?.trim());
}

export async function GET(req: Request) {
  if (!diagnosticAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = process.env;
  const report: Record<string, unknown> = {};

  // ── OTP mode ──────────────────────────────────────────────────────────────
  // In production NODE_ENV is always "production", so mockMode in issueOtp()
  // is always false regardless of MOCK_OTP. Real codes are always generated.
  report.otpCodeMode = env.NODE_ENV === "production"
    ? "real (NODE_ENV=production forces real codes)"
    : env.MOCK_OTP !== "false"
      ? "mock (MOCK_OTP not set to false — any 6 digits will verify)"
      : "real";

  // ── SMS path ──────────────────────────────────────────────────────────────
  const smsHasUsername = present(env.SMS_BROADCAST_USERNAME);
  const smsHasPassword = present(env.SMS_BROADCAST_PASSWORD);
  const smsMock = env.MOCK_SMS !== "false";
  const smsConfigured = smsHasUsername && smsHasPassword;

  report.sms = {
    mode: smsMock ? "MOCK — no SMS will be sent" : smsConfigured ? "LIVE" : "BROKEN — credentials missing",
    MOCK_SMS: env.MOCK_SMS ?? "(not set)",
    SMS_BROADCAST_USERNAME: smsHasUsername ? "present" : "MISSING",
    SMS_BROADCAST_PASSWORD: smsHasPassword ? "present" : "MISSING",
    SMS_BROADCAST_SENDER_ID: env.SMS_BROADCAST_SENDER_ID ?? "(not set — defaults to Mankin)",
    verdict: smsMock
      ? "Fix: set MOCK_SMS=false in Vercel environment variables (Production)"
      : smsConfigured
        ? "OK — SMS will fire for real"
        : "Fix: add SMS_BROADCAST_USERNAME and SMS_BROADCAST_PASSWORD in Vercel",
  };

  // ── Email / Graph path ────────────────────────────────────────────────────
  const outlookMock = env.MOCK_OUTLOOK_SEND === "true";
  const hasGraphCreds =
    present(env.MS_GRAPH_CLIENT_ID) &&
    present(env.MS_GRAPH_CLIENT_SECRET) &&
    present(env.MS_GRAPH_TENANT_ID);

  report.email = {
    mode: outlookMock ? "MOCK — no email will be sent" : "attempting real Graph send",
    MOCK_OUTLOOK_SEND: env.MOCK_OUTLOOK_SEND ?? "(not set — defaults to live)",
    graphCredentials: hasGraphCreds ? "present" : "MISSING",
  };

  if (outlookMock) {
    (report.email as Record<string, unknown>).verdict =
      "Fix: remove MOCK_OUTLOOK_SEND or set it to false in Vercel";
  } else if (!hasGraphCreds) {
    (report.email as Record<string, unknown>).verdict =
      "Fix: add MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID in Vercel";
  } else {
    // Probe the token and its roles — the only way to know if Mail.Send is
    // granted without actually sending an email.
    try {
      const { _resetGraphTokenCacheForTests, getGraphAppToken } = await import(
        "@/lib/clients/graph-token"
      );
      _resetGraphTokenCacheForTests();
      const token = await getGraphAppToken();

      let appId: unknown = "(could not decode)";
      let roles: unknown = "(could not decode)";
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        appId = payload.appid ?? payload.azp ?? "(not in token)";
        roles = payload.roles ?? [];
      } catch {
        // decode failed — token is still valid, roles are just unknown
      }

      const hasMailSend = Array.isArray(roles) && roles.includes("Mail.Send");

      (report.email as Record<string, unknown>).graphToken = {
        acquired: true,
        appId,
        roles,
        hasMailSend,
      };

      if (hasMailSend) {
        (report.email as Record<string, unknown>).verdict =
          "OK — Graph token has Mail.Send. Email should work. If still failing, check /api/health/graph-test which actually sends a test email.";
      } else {
        (report.email as Record<string, unknown>).verdict =
          `Fix: in Entra, find the app registration with appId=${String(appId)}, ` +
          "add API permission 'Mail.Send' (Application type, NOT Delegated), " +
          "then click 'Grant admin consent'. The token will update within seconds.";
      }
    } catch (err) {
      (report.email as Record<string, unknown>).graphToken = {
        acquired: false,
        error: err instanceof Error ? err.message : String(err),
      };
      (report.email as Record<string, unknown>).verdict =
        "Fix: Graph token acquisition failed — check MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID in Vercel";
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const smsOk = !smsMock && smsConfigured;
  const emailOk =
    !outlookMock &&
    hasGraphCreds &&
    Array.isArray((report.email as Record<string, unknown> & { graphToken?: { roles?: unknown } }).graphToken?.roles) &&
    ((report.email as Record<string, unknown> & { graphToken?: { roles?: string[] } }).graphToken?.roles ?? []).includes("Mail.Send");

  report.summary = {
    sms: smsOk ? "WORKING" : "BROKEN",
    email: emailOk ? "WORKING" : "BROKEN",
    bothBroken: !smsOk && !emailOk,
    note: "Fix the items above in Vercel Settings > Environment Variables, then redeploy and run this endpoint again.",
  };

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}

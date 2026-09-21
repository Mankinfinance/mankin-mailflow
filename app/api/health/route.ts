import { NextResponse } from "next/server";
import { diagnosticAuthorised } from "@/lib/diagnostic-access";

/**
 * Health / config-state endpoint. Liveness is public; the config detail
 * (mock flags, credential presence, the live SKIP_AUTH value) is gated
 * behind HEALTH_DIAGNOSTIC_TOKEN so it can't be scraped anonymously as a
 * reconnaissance oracle.
 *
 * Returns the live/mock state
 * of every integration on this deployment plus boolean flags for
 * whether each set of credentials is configured.
 *
 * Deliberately public so it can be probed by external tooling without
 * an auth dance. Reveals NO secret values — only:
 *
 *  - mock flags (SKIP_AUTH, MOCK_OUTLOOK_SEND, MOCK_SMS, etc.) as read
 *    from process.env, normalised to "live" / "mock"
 *  - boolean has* flags for whether each credential set is non-empty
 *    (no values, no lengths, no hashes — just presence)
 *  - the active git commit so we can correlate behaviour with code
 *
 * Safe to expose because nothing here is sensitive in isolation, and
 * the deployment URL is already public via Vercel.
 */

export const dynamic = "force-dynamic";
/* Edge runtime: this handler only reads env vars and serialises JSON,
   no Node-specific APIs. Edge cold-starts ~5x faster than nodejs
   (sub-100ms vs 200-400ms), which is the difference between this
   showing 800ms total and 300ms total from a probe halfway round
   the world. */
export const runtime = "edge";

function present(v: string | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
}

function mode(envVar: string | undefined, mockWhen: "set" | "unset-or-set"): "live" | "mock" {
  // Convention across the app:
  //   - SKIP_AUTH:           mock unless explicitly "false"  → "unset-or-set"
  //   - MOCK_SMS / OTP / DB: mock unless explicitly "false"  → "unset-or-set"
  //   - MOCK_OUTLOOK_SEND:   mock only when explicitly "true" → "set"
  //   - MOCK_CHAT:           mock unless explicitly "false"  → "unset-or-set"
  //   - MOCK_UPLOAD:         mock unless explicitly "false"  → "unset-or-set"
  //   - MOCK_SALESTREKKER:   mock unless explicitly "false"  → "unset-or-set"
  if (mockWhen === "set") {
    return envVar === "true" ? "mock" : "live";
  }
  return envVar !== "false" ? "mock" : "live";
}

export async function GET(req: Request) {
  // Public callers get liveness only. The config/recon detail below is
  // served only to a caller holding HEALTH_DIAGNOSTIC_TOKEN.
  if (!diagnosticAuthorised(req)) {
    return NextResponse.json(
      { ok: true, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }

  const env = process.env;

  const integrations = {
    brokerSso: mode(env.SKIP_AUTH, "unset-or-set"),
    outlookSend: mode(env.MOCK_OUTLOOK_SEND, "set"),
    sms: mode(env.MOCK_SMS, "unset-or-set"),
    otp: mode(env.MOCK_OTP, "unset-or-set"),
    anthropicChat: mode(env.MOCK_CHAT, "unset-or-set"),
    sharepointUpload: mode(env.MOCK_UPLOAD, "unset-or-set"),
    // DB persistence follows repos()/settlements-store: real Postgres
    // whenever DATABASE_URL is set, unless MOCK_DB="true" forces mock.
    auditLog:
      !present(env.DATABASE_URL) || env.MOCK_DB === "true" ? "mock" : "live",
    salestrekkerSource: mode(env.MOCK_SALESTREKKER, "unset-or-set"),
    // In-portal privacy e-sign is live only when explicitly enabled AND the
    // token + template id are both present; otherwise mock (tickbox).
    privacyEsign:
      env.MOCK_BREEZEDOC === "false" &&
      present(env.BREEZEDOC_API_TOKEN) &&
      (present(env.BREEZEDOC_TEMPLATE_ID) ||
        present(env.BREEZEDOC_TEMPLATE_ID_1))
        ? "live"
        : "mock",
  };

  const credentials = {
    AUTH_SECRET: present(env.AUTH_SECRET),
    AUTH_MICROSOFT_ENTRA_ID_ID: present(env.AUTH_MICROSOFT_ENTRA_ID_ID),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: present(env.AUTH_MICROSOFT_ENTRA_ID_SECRET),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: present(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER),
    MS_GRAPH_TENANT_ID: present(env.MS_GRAPH_TENANT_ID),
    MS_GRAPH_CLIENT_ID: present(env.MS_GRAPH_CLIENT_ID),
    MS_GRAPH_CLIENT_SECRET: present(env.MS_GRAPH_CLIENT_SECRET),
    SHAREPOINT_DRIVE_ID: present(env.SHAREPOINT_DRIVE_ID),
    DATABASE_URL: present(env.DATABASE_URL),
    CRON_SECRET: present(env.CRON_SECRET),
    ANTHROPIC_API_KEY: present(env.ANTHROPIC_API_KEY),
    SMS_BROADCAST_USERNAME: present(env.SMS_BROADCAST_USERNAME),
    SMS_BROADCAST_PASSWORD: present(env.SMS_BROADCAST_PASSWORD),
    SMS_BROADCAST_SENDER_ID: present(env.SMS_BROADCAST_SENDER_ID),
    SALESTREKKER_API_KEY: present(env.SALESTREKKER_API_KEY),
    WEBHOOK_SHARED_SECRET: present(env.WEBHOOK_SHARED_SECRET),
    BREEZEDOC_API_TOKEN: present(env.BREEZEDOC_API_TOKEN),
    BREEZEDOC_TEMPLATE_ID: present(env.BREEZEDOC_TEMPLATE_ID),
  };

  const rawEnvValues = {
    SKIP_AUTH: env.SKIP_AUTH ?? null,
    MOCK_OUTLOOK_SEND: env.MOCK_OUTLOOK_SEND ?? null,
    MOCK_SMS: env.MOCK_SMS ?? null,
    MOCK_OTP: env.MOCK_OTP ?? null,
    MOCK_CHAT: env.MOCK_CHAT ?? null,
    MOCK_UPLOAD: env.MOCK_UPLOAD ?? null,
    MOCK_DB: env.MOCK_DB ?? null,
    MOCK_SALESTREKKER: env.MOCK_SALESTREKKER ?? null,
    MAIL_READ_SCOPE: env.MAIL_READ_SCOPE ?? null,
    NODE_ENV: env.NODE_ENV ?? null,
    VERCEL_ENV: env.VERCEL_ENV ?? null,
    VERCEL_GIT_COMMIT_SHA: env.VERCEL_GIT_COMMIT_SHA ?? null,
  };

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      integrations,
      credentials,
      rawEnvValues,
    },
    {
      headers: {
        // Never cache - we want real-time config state on every probe.
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

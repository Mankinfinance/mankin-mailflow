import "server-only";

/**
 * SMS Broadcast client. Used for two surfaces:
 *   - Customer portal OTPs (lib/auth/portal-session.ts issueOtp)
 *   - Broker outbound SMS chases (sendFollowUp server action)
 *
 * SMS Broadcast is cheaper than ClickSend (~4c vs ~7c per AU SMS) and
 * the API is simple: POST form-urlencoded params, get back a text body
 * with one line per recipient.
 *
 * Activation:
 *   - Set SMS_BROADCAST_USERNAME (account email)
 *   - Set SMS_BROADCAST_PASSWORD (API password from account settings)
 *   - Set SMS_BROADCAST_SENDER_ID (alpha sender, e.g. "Mankin", max 11 chars)
 *   - Flip MOCK_SMS="false"
 *
 * Mock mode (default) logs to console + returns a fake success so dev
 * + preview environments never accidentally text real customers.
 *
 * Docs: https://www.smsbroadcast.com.au/api-documentation
 */

const API_URL = "https://api.smsbroadcast.com.au/api-adv.php";

export interface SendSmsInput {
  /** Recipient phone, any common AU format (0411234567, +61411234567,
   *  "0411 234 567"). Normalised to international before send. */
  to: string;
  /** Message body. SMS Broadcast splits messages over 160 chars into
   *  multiple segments automatically up to maxsplit. */
  message: string;
  /** Optional sender override. Falls back to SMS_BROADCAST_SENDER_ID
   *  env var, then to "Mankin". Alpha sender max 11 chars. */
  from?: string;
  /** Optional reference string echoed back with delivery receipts.
   *  Useful for correlating in the audit log. */
  ref?: string;
}

export interface SendSmsResult {
  ok: boolean;
  /** Where the message went, in international format. */
  to?: string;
  /** Provider's message reference, when available. */
  messageRef?: string;
  /** Human-readable error when ok=false. */
  error?: string;
  /** Whether the response came from the real provider or the mock. */
  source: "real" | "mock";
}

/**
 * Normalise an Australian phone number to international format without
 * the leading "+". SMS Broadcast accepts "61XXXXXXXXX" directly.
 *
 *   "0411 234 567"     → "61411234567"
 *   "+61 411 234 567"  → "61411234567"
 *   "61411234567"      → "61411234567"
 *
 * Returns null when the input doesn't look like a valid AU mobile.
 */
export function normaliseAuPhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 0) return null;

  // Already starts with country code
  if (digits.startsWith("61") && digits.length === 11) return digits;

  // Local format (04XX XXX XXX, drops leading 0, prefixes 61)
  if (digits.startsWith("04") && digits.length === 10) {
    return "61" + digits.slice(1);
  }

  // Less common but seen: just the 9 mobile digits (4XX XXX XXX)
  if (digits.startsWith("4") && digits.length === 9) {
    return "61" + digits;
  }

  return null;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.SMS_BROADCAST_USERNAME && process.env.SMS_BROADCAST_PASSWORD,
  );
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const to = normaliseAuPhone(input.to);
  if (!to) {
    return {
      ok: false,
      error: `Could not normalise phone: ${input.to}`,
      source: isConfigured() && process.env.MOCK_SMS === "false" ? "real" : "mock",
    };
  }

  const from = (input.from ?? process.env.SMS_BROADCAST_SENDER_ID ?? "Mankin").slice(0, 11);

  // Mock branch: any of:
  //   - MOCK_SMS not explicitly set to "false"
  //   - SMS Broadcast credentials missing
  if (process.env.MOCK_SMS !== "false" || !isConfigured()) {
    console.log(
      `[mock sms-broadcast] to=${to} from="${from}" ref="${input.ref ?? ""}" body=${JSON.stringify(input.message)}`,
    );
    return {
      ok: true,
      to,
      messageRef: `mock-${Date.now()}`,
      source: "mock",
    };
  }

  // Real send
  const body = new URLSearchParams({
    // Trim to defend against a trailing space / newline pasted into the
    // Vercel value, which SMS Broadcast rejects as "username or password is
    // incorrect" just like a genuinely wrong credential.
    username: process.env.SMS_BROADCAST_USERNAME!.trim(),
    password: process.env.SMS_BROADCAST_PASSWORD!.trim(),
    to,
    from,
    message: input.message,
    // Allow up to 4 segments (640 chars). Anything longer indicates a
    // template bug; SMS Broadcast would truncate silently.
    maxsplit: "4",
    ...(input.ref ? { ref: input.ref } : {}),
  });

  let resp: Response;
  try {
    resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    console.error("[sms-broadcast] network error", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
      source: "real",
    };
  }

  const text = (await resp.text()).trim();

  // Response shape: one line per recipient.
  //   OK: 61411234567:<messageRef>
  //   BAD: 61411234567:<reason>
  // We only ever send to one recipient so we just look at the first line.
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const okMatch = /^OK:\s*([^:]+):(.+)$/i.exec(firstLine);
  if (okMatch) {
    return {
      ok: true,
      to: okMatch[1].trim(),
      messageRef: okMatch[2].trim(),
      source: "real",
    };
  }

  const badMatch = /^BAD:\s*([^:]+):(.+)$/i.exec(firstLine);
  if (badMatch) {
    return {
      ok: false,
      to: badMatch[1].trim(),
      error: badMatch[2].trim(),
      source: "real",
    };
  }

  // Unrecognised response - log raw for debugging.
  console.error(`[sms-broadcast] unexpected response (${resp.status}): ${text.slice(0, 200)}`);
  return {
    ok: false,
    error: `Unexpected response: ${text.slice(0, 100)}`,
    source: "real",
  };
}

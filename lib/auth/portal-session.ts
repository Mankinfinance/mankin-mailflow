import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { sendSms } from "@/lib/clients/sms-broadcast";
import { auth } from "@/auth";
import { timingSafeEqualStr } from "@/lib/constant-time";

/**
 * Portal session — set after a customer verifies their OTP code on a
 * given device. Lasts 60 minutes per security.jsx; 15-min idle re-OTP
 * is enforced via the `lastSeenAt` claim refreshed on every server-side
 * portal page render.
 */

const COOKIE_NAME = "mankin_portal_session";
const ISSUER = "mankin-followup";
const AUDIENCE = "portal-session";

export const PORTAL_SESSION_TTL_MIN = 60;
export const PORTAL_SESSION_IDLE_LIMIT_MIN = 15;

export interface PortalSessionClaims {
  dealId: string;
  /** sms | email — which method the customer verified with */
  method: "sms" | "email";
  /** epoch seconds — last server-side activity */
  lastSeenAt: number;
}

interface JwtSession extends PortalSessionClaims, JWTPayload {}

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing");
  return new TextEncoder().encode(secret);
}

async function sign(claims: PortalSessionClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + PORTAL_SESSION_TTL_MIN * 60)
    .sign(key());
}

export async function startPortalSession(claims: Omit<PortalSessionClaims, "lastSeenAt">): Promise<void> {
  const lastSeenAt = Math.floor(Date.now() / 1000);
  const token = await sign({ ...claims, lastSeenAt });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PORTAL_SESSION_TTL_MIN * 60,
  });
}

export async function endPortalSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export interface ActivePortalSession extends PortalSessionClaims {
  expiresInMin: number;
}

/**
 * Returns the active session for the given deal, or null if absent /
 * expired / idle / mismatched. Refreshes lastSeenAt as a side effect when
 * still valid so the 15-min idle clock resets on activity.
 */
export async function getActivePortalSession(dealId: string): Promise<ActivePortalSession | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  try {
    const { payload } = await jwtVerify<JwtSession>(raw, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (payload.dealId !== dealId) return null;

    const now = Math.floor(Date.now() / 1000);
    const idleSec = now - payload.lastSeenAt;
    if (idleSec > PORTAL_SESSION_IDLE_LIMIT_MIN * 60) {
      // Can't delete the cookie from a Server Component (only Server
      // Actions can). Treat it as expired here; next Action call clears it.
      return null;
    }

    // We deliberately don't refresh lastSeenAt during a server-component
    // read because Next 16 blocks cookie writes outside Server Actions /
    // Route Handlers. The 60-min absolute expiry is enforced by the JWT
    // exp claim; idle is rechecked when any server action runs.
    const exp = typeof payload.exp === "number" ? payload.exp : now;
    return {
      dealId: payload.dealId,
      method: payload.method,
      lastSeenAt: now,
      expiresInMin: Math.max(0, Math.round((exp - now) / 60)),
    };
  } catch {
    return null;
  }
}

/**
 * Re-sign the session cookie with a fresh lastSeenAt (and a fresh 60-min
 * absolute expiry). Slides the 15-min idle window on activity. Safe to
 * call only from a Server Action / Route Handler — Next 16 forbids cookie
 * writes during a Server Component render, so callers swallow the throw.
 */
export async function refreshPortalSession(
  dealId: string,
  method: "sms" | "email",
): Promise<void> {
  const token = await sign({
    dealId,
    method,
    lastSeenAt: Math.floor(Date.now() / 1000),
  });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PORTAL_SESSION_TTL_MIN * 60,
  });
}

/**
 * Authorise a portal WRITE action (upload, flag, add-person, edit
 * details). Returns the actor, or null if unauthorised:
 *  - "customer": a valid OTP session for this deal. Its idle window is
 *    slid forward so an active customer is never bounced mid-session.
 *  - "broker": no OTP session, but a Mankin broker is signed in via
 *    Microsoft SSO — i.e. they're previewing the portal and testing it.
 *    This is why "I test the portal myself" previously failed: the broker
 *    preview has no OTP session, so every upload returned "session
 *    expired". Broker SSO is trusted, so we let them act.
 */
export async function requirePortalActor(
  dealId: string,
): Promise<"customer" | "broker" | null> {
  const session = await getActivePortalSession(dealId);
  if (session) {
    // Slide the idle window on activity (cookie writes are allowed here).
    await refreshPortalSession(session.dealId, session.method).catch(() => {});
    return "customer";
  }
  try {
    const broker = await auth();
    if (broker?.user) return "broker";
  } catch {
    // auth() can throw in edge cases; treat as unauthenticated.
  }
  return null;
}

/* --------------------------------------------------------------------------
   OTP issuance + verification.

   Codes are persisted in Postgres (otp_codes table via repos().otpCode) so
   they survive across Vercel serverless Lambda invocations. In local dev
   (MOCK_DB=true), repos() returns mock implementations backed by an
   in-process Map — which is fine because dev runs as a single process.

   MOCK_OTP=false (real mode):
     - SMS: fires SMS Broadcast API
     - Email: fires Microsoft Graph app-only send via outlook-app-only.ts

   MOCK_OTP=true (default in dev):
     - Code is always "123456"; any 6 digits verify successfully.
     - No SMS or email is sent.
-------------------------------------------------------------------------- */

export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Cryptographically secure 6-digit OTP (100000–999999). Uses Web Crypto
 * with rejection sampling so the distribution is uniform (no modulo bias),
 * unlike Math.random() whose PRNG state can be reconstructed from outputs.
 */
function secureSixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 900000) * 900000;
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return (100000 + (n % 900000)).toString();
}

export async function issueOtp(
  dealId: string,
  method: "sms" | "email",
  contact?: { phone?: string; email?: string; brokerEmail?: string },
): Promise<void> {
  const mockMode =
    process.env.NODE_ENV !== "production" && process.env.MOCK_OTP !== "false";
  const code = mockMode ? "123456" : secureSixDigitCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  // Persist via repos() — uses Postgres in production, in-memory in dev.
  const { repos } = await import("@/lib/db/repos");
  await repos().otpCode.upsert({ dealId, method, code, expiresAt });

  if (mockMode) {
    console.log(`[mock otp] dealId=${dealId} method=${method} code=${code}`);
    return;
  }

  if (method === "sms") {
    if (!contact?.phone) {
      throw new Error("issueOtp: SMS method requires a phone number on the contact");
    }
    const message = `Your Mankin Finance verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes. Don't share this with anyone. We will never ask you for it over the phone.`;
    const result = await sendSms({
      to: contact.phone,
      message,
      ref: `otp-${dealId}`,
    });
    if (!result.ok) {
      throw new Error(`SMS send failed: ${result.error ?? "unknown error"}`);
    }
    // We only reach here when a real send was intended (mock mode returns
    // the fixed code earlier without calling sendSms). If the SMS client
    // still mocked, the credentials aren't configured — surface that instead
    // of silently marching the customer to a code screen for a text that
    // was never sent.
    if (result.source === "mock") {
      throw new Error(
        "SMS OTP was not actually sent: SMS Broadcast is in mock mode. Set SMS_BROADCAST_USERNAME, SMS_BROADCAST_PASSWORD, SMS_BROADCAST_SENDER_ID and MOCK_SMS=false.",
      );
    }
    return;
  }

  if (method === "email") {
    if (!contact?.email) {
      throw new Error("issueOtp: email method requires an email address on the contact");
    }
    const from = contact.brokerEmail ?? "michael@mankinfinance.com";
    const { sendEmailViaOutlookAppOnly } = await import("@/lib/clients/outlook-app-only");
    await sendEmailViaOutlookAppOnly({
      from,
      to: contact.email,
      subject: "Your Mankin Finance verification code",
      body: [
        `Your one-time portal verification code is:`,
        ``,
        `    ${code}`,
        ``,
        `This code expires in ${OTP_TTL_MIN} minutes.`,
        ``,
        `Do not share this code with anyone. We will never ask for it over the phone.`,
        `If you did not request this code, please call Michael on 0420 699 983.`,
      ].join("\n"),
      saveToSentItems: false,
    });
    return;
  }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "mismatch" };

export async function verifyOtp(dealId: string, method: "sms" | "email", code: string): Promise<VerifyOtpResult> {
  // Dev fast-path: any 6 digits verify when in non-production mock mode.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.MOCK_OTP !== "false" &&
    /^\d{6}$/.test(code)
  ) {
    return { ok: true };
  }

  const { repos } = await import("@/lib/db/repos");
  const otpRepo = repos().otpCode;

  const rec = await otpRepo.find(dealId, method);
  if (!rec) return { ok: false, reason: "no_code" };

  if (rec.expiresAt < new Date()) {
    await otpRepo.delete(dealId, method);
    return { ok: false, reason: "expired" };
  }

  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    await otpRepo.delete(dealId, method);
    return { ok: false, reason: "too_many_attempts" };
  }

  await otpRepo.incrementAttempts(dealId, method);
  if (!timingSafeEqualStr(rec.code, code)) return { ok: false, reason: "mismatch" };

  await otpRepo.delete(dealId, method);
  return { ok: true };
}

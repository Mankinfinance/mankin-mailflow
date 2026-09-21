import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Customer portal tokens — single-purpose JWTs that gate access to
 * /portal/[token]. Issued by a broker action on a deal; sent to the
 * customer via SMS/email; 14-day expiry per security.jsx.
 *
 * Token claims include deal id + customer first name + masked contact
 * so we can render "Welcome back, Sarah" pre-OTP without an extra
 * round-trip to Salestrekker on every page load.
 */

export interface PortalTokenClaims {
  /** Salestrekker deal id */
  dealId: string;
  /** Customer first name — shown pre-OTP on the auth gate */
  firstName: string;
  /** Last 3 digits of mobile, e.g. "567" */
  mobileSuffix: string;
  /** Email local-part first char + masked, e.g. "s****@gmail.com" */
  maskedEmail: string;
  /** Audit: which broker generated this link */
  issuedBy: string;
}

interface JwtPortalClaims extends PortalTokenClaims, JWTPayload {}

const ISSUER = "mankin-followup";
const AUDIENCE = "portal";

/** Days the token stays valid after issuance. Per security.jsx. */
export const PORTAL_TOKEN_TTL_DAYS = 14;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing — needed to sign portal tokens.");
  return new TextEncoder().encode(secret);
}

export async function issuePortalToken(claims: PortalTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + PORTAL_TOKEN_TTL_DAYS * 24 * 60 * 60;

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
}

export type VerifyResult =
  | { ok: true; claims: PortalTokenClaims; expiresAt: Date }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyPortalToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify<JwtPortalClaims>(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (!payload.dealId || !payload.firstName || typeof payload.exp !== "number") {
      return { ok: false, reason: "invalid" };
    }

    return {
      ok: true,
      claims: {
        dealId: payload.dealId,
        firstName: payload.firstName,
        mobileSuffix: payload.mobileSuffix,
        maskedEmail: payload.maskedEmail,
        issuedBy: payload.issuedBy,
      },
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code: string }).code : "";
    if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

/* --------------------------------------------------------------------------
   Helpers for deriving claim values from a Deal — keeps the token compact
   and consistent across the broker-side issue flow and customer-side render.
-------------------------------------------------------------------------- */

export function maskedEmailOf(email: string): string {
  const [local, domain = ""] = email.split("@");
  if (!local) return email;
  return `${local[0]}****@${domain}`;
}

export function mobileSuffixOf(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-3);
}

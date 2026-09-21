import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "crypto";

export interface ReferrerTokenClaims {
  referrerId: string;
  referrerName: string;
  /** accountant | real-estate | planner | other */
  referrerType: string;
}

interface JwtReferrerClaims extends ReferrerTokenClaims, JWTPayload {}

const ISSUER = "mankin-followup";
const AUDIENCE = "referrer";

export const REFERRER_TOKEN_TTL_DAYS = 90;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing — needed to sign referrer tokens.");
  return new TextEncoder().encode(secret);
}

export async function issueReferrerToken(claims: ReferrerTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + REFERRER_TOKEN_TTL_DAYS * 24 * 60 * 60;

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
}

export type ReferrerVerifyResult =
  | { ok: true; claims: ReferrerTokenClaims; expiresAt: Date }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyReferrerToken(token: string): Promise<ReferrerVerifyResult> {
  try {
    const { payload } = await jwtVerify<JwtReferrerClaims>(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (!payload.referrerId || !payload.referrerName || typeof payload.exp !== "number") {
      return { ok: false, reason: "invalid" };
    }

    return {
      ok: true,
      claims: {
        referrerId: payload.referrerId,
        referrerName: payload.referrerName,
        referrerType: payload.referrerType ?? "other",
      },
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code: string }).code : "";
    if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export function hashReferrerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

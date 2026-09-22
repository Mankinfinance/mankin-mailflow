import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { portalBaseUrl } from "@/lib/portal-link";

/**
 * The signed link behind a survey invitation.
 *
 * A survey answer is worth far more attributed than anonymous: knowing
 * that the client who would not recommend us is the one whose loan took
 * eleven weeks is the difference between a number and a phone call. So
 * the invitation carries a token naming its recipient, and the response
 * page reads it — nobody is asked to identify themselves, and nobody
 * can answer as someone else.
 *
 * Its own audience claim, deliberately, so a tracking token cannot be
 * replayed here and a survey token cannot be used to unsubscribe
 * somebody. Same reasoning as lib/campaigns/tracking.ts, which keeps
 * itself separate from the portal tokens for the same reason.
 */

const ISSUER = "mankin-mailflow";
const AUDIENCE = "survey";

/**
 * Shorter-lived than an unsubscribe link, which must work forever. A
 * survey is about a moment — a settlement, an approval — and an answer
 * arriving eight months later is not measuring what the question asked.
 * Long enough that a holiday does not cost the response.
 */
const TOKEN_TTL_DAYS = 120;

export interface SurveyClaims {
  /** Survey being answered. */
  sid: string;
  /** Recipient address, lower-cased. */
  em: string;
  /** Display name, so the page can greet them without a lookup. */
  nm: string;
}

interface JwtSurveyClaims extends SurveyClaims, JWTPayload {}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET missing — needed to sign survey links.");
  }
  return new TextEncoder().encode(secret);
}

export async function issueSurveyToken(claims: SurveyClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, em: claims.em.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_DAYS * 24 * 60 * 60)
    .sign(secretKey());
}

export type VerifySurveyResult =
  | { ok: true; claims: SurveyClaims }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifySurveyToken(
  token: string,
): Promise<VerifySurveyResult> {
  try {
    const { payload } = await jwtVerify<JwtSurveyClaims>(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sid || !payload.em) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      claims: { sid: payload.sid, em: payload.em, nm: payload.nm ?? "" },
    };
  } catch (err) {
    /* jose verifies the signature before it checks expiry, so an
       ERR_JWT_EXPIRED means the token was genuinely ours — worth
       telling apart from a forgery so the page can say "this link has
       expired" rather than "this link is not valid". */
    const code = (err as { code?: string })?.code;
    if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

/** The URL that goes in the invitation. */
export async function surveyLink(args: {
  surveyId: string;
  email: string;
  name: string;
}): Promise<string> {
  const token = await issueSurveyToken({
    sid: args.surveyId,
    em: args.email,
    nm: args.name,
  });
  return `${portalBaseUrl()}/s/${token}`;
}

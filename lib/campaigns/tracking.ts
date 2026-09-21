import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { portalBaseUrl } from "@/lib/portal-link";

/**
 * Signed tokens behind the three public campaign endpoints: unsubscribe,
 * open pixel and click redirect.
 *
 * Why signed rather than a database id in the URL: these links land in
 * hundreds of inboxes and get forwarded, scanned and archived. A signed
 * token means the endpoints can trust which campaign and which recipient
 * they are being asked about without a lookup table of guessable ids,
 * and an unsubscribe link cannot be edited into someone else's address.
 *
 * Same AUTH_SECRET and the same jose primitives as the portal tokens
 * (lib/auth/portal-token.ts), with their own audience claim so a portal
 * token can never be replayed at a tracking endpoint or vice versa.
 */

const ISSUER = "mankin-followup";
const AUDIENCE = "campaign";

/**
 * Long-lived by design. An unsubscribe link must still work when someone
 * digs the email out of their archive a year later — the Spam Act gives
 * no expiry on the right to opt out, so neither do we.
 */
const TOKEN_TTL_DAYS = 730;

export type TrackingPurpose = "unsubscribe" | "open" | "click";

export interface TrackingClaims {
  /** Campaign the email belongs to. */
  cid: string;
  /** Recipient address, lower-cased — the suppression key. */
  em: string;
  /** What the token is allowed to do. */
  p: TrackingPurpose;
}

interface JwtTrackingClaims extends TrackingClaims, JWTPayload {}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET missing — needed to sign campaign links.");
  }
  return new TextEncoder().encode(secret);
}

export async function issueTrackingToken(
  claims: TrackingClaims,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, em: claims.em.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_DAYS * 24 * 60 * 60)
    .sign(secretKey());
}

export type VerifyTrackingResult =
  | { ok: true; claims: TrackingClaims }
  | { ok: false; reason: "expired" | "invalid" | "wrong-purpose" };

export async function verifyTrackingToken(
  token: string,
  expected: TrackingPurpose,
): Promise<VerifyTrackingResult> {
  try {
    const { payload } = await jwtVerify<JwtTrackingClaims>(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.cid || !payload.em || !payload.p) {
      return { ok: false, reason: "invalid" };
    }
    if (payload.p !== expected) return { ok: false, reason: "wrong-purpose" };
    return {
      ok: true,
      claims: { cid: payload.cid, em: payload.em, p: payload.p },
    };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

/**
 * The three URLs one recipient's email needs. Built once per recipient
 * at send time and handed to the renderer, which stays pure.
 *
 * Click tracking wraps the destination in a redirect that records the
 * click and then forwards. The original URL travels in the query string
 * rather than the token so one token covers every link in the body.
 *
 * That makes `u` attacker-controlled, and safeRedirectTarget only pins
 * the scheme, not the host — so the redirect route forwards to it only
 * once the token has proved authentic. See app/e/c/[token]/route.ts.
 */
export interface RecipientLinks {
  /** The link in the email body, for a person reading it. Confirms
   *  before acting, because scanners follow links. */
  unsubscribeUrl: string;
  /** The endpoint named in the List-Unsubscribe header, which Gmail and
   *  Yahoo POST to. Acts immediately, per RFC 8058. */
  oneClickUrl: string;
  openPixelUrl?: string;
  wrapUrl?: (url: string) => string;
}

export async function buildRecipientLinks(args: {
  campaignId: string;
  email: string;
  trackOpens: boolean;
  trackClicks: boolean;
}): Promise<RecipientLinks> {
  const base = portalBaseUrl();
  const email = args.email.toLowerCase();

  const unsubscribeToken = await issueTrackingToken({
    cid: args.campaignId,
    em: email,
    p: "unsubscribe",
  });
  const links: RecipientLinks = {
    unsubscribeUrl: `${base}/e/u/${unsubscribeToken}`,
    // Same token, different endpoint: one confirms, one acts.
    oneClickUrl: `${base}/api/e/u/${unsubscribeToken}`,
  };

  if (args.trackOpens) {
    const openToken = await issueTrackingToken({
      cid: args.campaignId,
      em: email,
      p: "open",
    });
    links.openPixelUrl = `${base}/e/o/${openToken}`;
  }

  if (args.trackClicks) {
    const clickToken = await issueTrackingToken({
      cid: args.campaignId,
      em: email,
      p: "click",
    });
    links.wrapUrl = (url: string) =>
      `${base}/e/c/${clickToken}?u=${encodeURIComponent(url)}`;
  }

  return links;
}

/**
 * Only ever forward to an ordinary web address. Guards the click
 * redirect against an open-redirect into javascript:/data: schemes if
 * someone hand-edits the query string.
 */
export function safeRedirectTarget(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

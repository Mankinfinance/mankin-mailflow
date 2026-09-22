import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing a delivery so the receiver can prove it came from us.
 *
 * An endpoint URL is a public address. Anything that can reach it can
 * POST to it, so without a signature "Mailflow says this client
 * unsubscribed" is a sentence anyone on the internet can say. The
 * signature is what makes the payload worth acting on.
 *
 * The timestamp is inside the signed material, not merely alongside
 * it. Signing the body alone lets an attacker who captures one
 * delivery replay it forever; signing `timestamp.body` means a replay
 * has to carry the original timestamp, which the receiver rejects as
 * too old. This is the same construction Stripe and GitHub use, for
 * the same reason.
 */

export const SIGNATURE_HEADER = "x-mailflow-signature";
export const TIMESTAMP_HEADER = "x-mailflow-timestamp";
export const EVENT_HEADER = "x-mailflow-event";
export const DELIVERY_HEADER = "x-mailflow-delivery";

/** How old a delivery may be before a receiver should refuse it. */
export const REPLAY_WINDOW_SECONDS = 300;

/** `sha256=<hex>` over `<timestamp>.<body>`. */
export function signPayload(args: {
  body: string;
  timestamp: number;
  secret: string;
}): string {
  const mac = createHmac("sha256", args.secret);
  mac.update(`${args.timestamp}.${args.body}`);
  return `sha256=${mac.digest("hex")}`;
}

/**
 * Verify a delivery. Written here as well as sent from here so the
 * receiving side has a reference implementation that is known to
 * match, and so it can be tested.
 */
export function verifySignature(args: {
  body: string;
  timestamp: number;
  signature: string;
  secret: string;
  /** Overridable so the check itself is testable without waiting. */
  now?: number;
}): { ok: true } | { ok: false; reason: "stale" | "mismatch" | "malformed" } {
  if (!args.signature.startsWith("sha256=")) {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(args.timestamp)) {
    return { ok: false, reason: "malformed" };
  }

  const now = args.now ?? Math.floor(Date.now() / 1000);
  /* Absolute difference, so a delivery timestamped in the future is
     rejected too — clock skew forward is as suspicious as backward. */
  if (Math.abs(now - args.timestamp) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = signPayload({
    body: args.body,
    timestamp: args.timestamp,
    secret: args.secret,
  });

  /* Constant-time, because a fast-failing string compare leaks how
     much of a guessed signature was right, one byte at a time. */
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/**
 * A fresh endpoint secret.
 *
 * Shown once when the endpoint is created and never again — the same
 * bargain Azure makes with a client secret, for the same reason: a
 * secret that can be re-read is a secret that leaks through whoever
 * can read it.
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${Buffer.from(bytes).toString("base64url")}`;
}

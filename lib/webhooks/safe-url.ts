/**
 * Deciding whether a webhook URL is safe for this server to POST to.
 *
 * This is the vulnerability that comes free with the feature. An
 * outbound webhook makes the server fetch an address a user typed, so
 * without a check the feature is a request forgery tool with a nice
 * settings page: point it at 169.254.169.254 and the server reads its
 * own cloud metadata, or at an internal host and it becomes a probe
 * for services that were never meant to face the internet.
 *
 * Four rules, and one honest limitation.
 *
 *  1. HTTPS only. These payloads carry client email addresses, and
 *     plaintext delivery of those over the open internet is not
 *     something to leave as the operator's choice.
 *  2. No credentials in the URL, no non-default ports. A webhook
 *     receiver lives on 443; anything else is usually someone probing.
 *  3. The hostname must not resolve into private, loopback,
 *     link-local, carrier-grade NAT or unique-local space.
 *  4. Redirects are never followed by the sender. An allowed host that
 *     302s to 127.0.0.1 would otherwise walk straight past rule 3.
 *
 * The limitation: rule 3 resolves DNS and then the fetch resolves it
 * again, so a name that answers publicly at save time and privately a
 * moment later — DNS rebinding — is not fully closed off by this.
 * Closing it properly means connecting to the validated address with
 * an explicit Host header, which `fetch` does not expose. The check is
 * run at save time AND immediately before every send, which shrinks
 * the window to the length of one request without eliminating it.
 * Saying so here rather than implying the guard is airtight.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** Ports a webhook receiver plausibly listens on. */
const ALLOWED_PORTS = new Set(["", "443"]);

export async function checkWebhookUrl(raw: string): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a URL." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: "Webhooks must be HTTPS — the payload carries client addresses.",
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Put credentials in a header, not in the URL." };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "Use the standard HTTPS port." };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  /* A literal address skips DNS entirely, so check it directly — this
     is the form an attacker reaches for first. */
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, reason: "That address is on a private network." }
      : { ok: true, url: url.toString() };
  }

  if (isLocalName(host)) {
    return { ok: false, reason: "That address is on a private network." };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "That hostname could not be resolved." };
  }
  if (resolved.length === 0) {
    return { ok: false, reason: "That hostname could not be resolved." };
  }

  /* Every answer must be public. A name that returns one public and
     one private address is not half-safe — the connection could use
     either. */
  for (const answer of resolved) {
    if (isPrivateAddress(answer.address)) {
      return { ok: false, reason: "That hostname points at a private network." };
    }
  }

  return { ok: true, url: url.toString() };
}

/** Names that never belong to a public receiver. */
function isLocalName(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".home.arpa")
  );
}

/**
 * Whether an IP literal sits in a range that is not routable on the
 * public internet.
 *
 * Exported because it is the part worth testing exhaustively: every
 * entry here is a range that has been used to turn this class of
 * feature into a server-side request forgery.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  /* Unparseable is not safe by default. */
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase();

  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast

  /* ::ffff:127.0.0.1 and friends — an IPv4 address wearing an IPv6
     coat, which reaches exactly the same host. */
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);

  /* Hex-form mapped addresses, ::ffff:7f00:1 */
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const v4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
    return isPrivateV4(v4);
  }

  /* NAT64 well-known prefix, which translates to a v4 destination we
     cannot see from here. */
  if (lower.startsWith("64:ff9b:")) return true;

  return false;
}

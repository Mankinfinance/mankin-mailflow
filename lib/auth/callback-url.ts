/**
 * Where to send a broker after they sign in.
 *
 * The proxy bounces an unauthenticated request to `/login` and Auth.js
 * appends the original path as `callbackUrl`. Ignoring it means every
 * deep link anyone shares — a campaign, a survey, the database page —
 * silently becomes "the dashboard" for anyone whose session has
 * lapsed, which reads as the link being wrong.
 *
 * Honouring it needs care, because the value arrives in a query string
 * and anyone can put anything there. A sign-in page that redirects to
 * an attacker's URL is the classic open redirect: the link genuinely
 * starts on our domain, the broker genuinely signs in, and the landing
 * page is a convincing fake asking them to do it again.
 *
 * So: same-origin paths only, and nothing clever.
 */

export const DEFAULT_SIGNED_IN_PATH = "/marketing";

export function safeCallbackPath(
  raw: string | undefined,
  /** The app's own origin, when Auth.js sent an absolute URL. */
  origin?: string,
): string {
  if (!raw) return DEFAULT_SIGNED_IN_PATH;

  let value = raw.trim();
  if (!value) return DEFAULT_SIGNED_IN_PATH;

  /* Auth.js sometimes hands back a full URL rather than a path. Accept
     it only when the origin is ours, and reduce it to a path either
     way so nothing downstream has to trust a hostname. */
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (!origin || parsed.origin !== origin) return DEFAULT_SIGNED_IN_PATH;
      value = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return DEFAULT_SIGNED_IN_PATH;
    }
  }

  /* "//evil.com" is a protocol-relative URL, not a path — browsers
     follow it off-site. It is the single most-missed case here, which
     is why it gets its own check before the leading-slash one passes
     it through. */
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  /* Anything not plainly rooted — "javascript:…", "mailto:…", a bare
     "evil.com", a backslash Windows treats as a separator. */
  if (!value.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  if (value.includes("\\")) return DEFAULT_SIGNED_IN_PATH;

  /* Sending someone back to the sign-in page after signing in is a
     loop, not a destination. */
  if (value === "/login" || value.startsWith("/login?")) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  return value;
}

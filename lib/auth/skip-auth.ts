/**
 * Authentication bypass gate. Edge-safe (only reads process.env + strings)
 * so both the proxy (auth.config.ts) and current-broker.ts can share it.
 *
 * Bypass is allowed ONLY in local development AND ONLY when explicitly opted
 * in with SKIP_AUTH="true". Critically it is gated on NODE_ENV: every Vercel
 * deployment (production and preview) sets NODE_ENV="production", so on any
 * deployment auth is ALWAYS enforced no matter what SKIP_AUTH is. A missing,
 * empty, or typo'd env var can no longer open the dashboard.
 *
 * This replaces the previous `SKIP_AUTH !== "false"` check, which failed
 * OPEN on any value but the exact string "false".
 */
export function authBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.SKIP_AUTH === "true";
}

/**
 * Email domains whose Microsoft accounts belong to Mankin Finance. Used to
 * stop a non-Mankin email from being mapped to a team member by local-part
 * collision. Override with ALLOWED_EMAIL_DOMAINS (comma-separated) if the
 * tenant uses additional verified domains.
 */
export function allowedEmailDomains(): string[] {
  const fromEnv = process.env.ALLOWED_EMAIL_DOMAINS?.trim();
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }
  return ["mankinfinance.com", "mankinfinance.com.au"];
}

export function emailDomainAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return allowedEmailDomains().includes(domain);
}

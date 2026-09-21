import "server-only";

/**
 * Microsoft Graph OAuth2 token cache for the app-only client_credentials
 * flow. Used by sharepoint.ts (and any other Graph client we add later)
 * to share one bearer across requests rather than re-acquiring on every
 * upload.
 *
 * Tokens live for 3600s in real Azure AD. We cache for 50min (3000s) with
 * 60s jitter to leave a buffer for clock skew, refresh, and the actual
 * request.
 */

interface CachedToken {
  bearer: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;

const CACHE_TTL_MS = 50 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function getGraphAppToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.bearer;
  }

  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "MS_GRAPH_TENANT_ID + MS_GRAPH_CLIENT_ID + MS_GRAPH_CLIENT_SECRET must all be set to acquire a Graph token. See docs/sharepoint-setup.md.",
    );
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json()) as TokenResponse;
  if (!resp.ok || !json.access_token) {
    throw new Error(
      `Graph token request failed (${resp.status}): ${json.error_description ?? json.error ?? "unknown error"}`,
    );
  }

  cached = {
    bearer: json.access_token,
    expiresAt: now + Math.min(CACHE_TTL_MS, (json.expires_in ?? 3600) * 1000 - 60_000),
  };
  return cached.bearer;
}

/** Test hook: clear the in-memory cache between runs */
export function _resetGraphTokenCacheForTests(): void {
  cached = null;
}

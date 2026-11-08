import { timingSafeEqualStr } from "@/lib/constant-time";

/**
 * Guards the /api/health* diagnostic endpoints. Left ungated they disclose
 * the deployment's security posture (mock flags, the live SKIP_AUTH value,
 * which secrets are configured) or take real actions (graph-test sends an
 * email). That is a precise reconnaissance oracle for an attacker.
 *
 * Fail closed: detail is served only when HEALTH_DIAGNOSTIC_TOKEN is set AND
 * the caller supplies it in the `x-health-token` header (not the query string, which ends up in logs). With
 * the env var unset, no caller is ever authorised — the endpoints return a
 * bare liveness response or 401 instead.
 */
export function diagnosticAuthorised(req: Request): boolean {
  const secret = process.env.HEALTH_DIAGNOSTIC_TOKEN?.trim();
  if (!secret) return false;
  /* Header only. A token in the query string is written into Vercel's
     request logs, browser history and any proxy in between. */
  const provided = req.headers.get("x-health-token") ?? "";
  return provided.length > 0 && timingSafeEqualStr(provided, secret);
}

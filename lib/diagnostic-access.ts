import { timingSafeEqualStr } from "@/lib/constant-time";

/**
 * Guards the /api/health* diagnostic endpoints. Left ungated they disclose
 * the deployment's security posture (mock flags, the live SKIP_AUTH value,
 * which secrets are configured) or take real actions (graph-test sends an
 * email). That is a precise reconnaissance oracle for an attacker.
 *
 * Fail closed: detail is served only when HEALTH_DIAGNOSTIC_TOKEN is set AND
 * the caller supplies it via `?token=` or the `x-health-token` header. With
 * the env var unset, no caller is ever authorised — the endpoints return a
 * bare liveness response or 401 instead.
 */
export function diagnosticAuthorised(req: Request): boolean {
  const secret = process.env.HEALTH_DIAGNOSTIC_TOKEN?.trim();
  if (!secret) return false;
  let provided = "";
  try {
    provided = new URL(req.url).searchParams.get("token") ?? "";
  } catch {
    provided = "";
  }
  if (!provided) provided = req.headers.get("x-health-token") ?? "";
  return provided.length > 0 && timingSafeEqualStr(provided, secret);
}

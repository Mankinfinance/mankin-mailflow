import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/constant-time";
import { auditLog } from "@/lib/audit";
import { reconcileBounces } from "@/lib/campaigns/reconcile-bounces";

/**
 * Daily bounce reconciliation.
 *
 * Reads recent non-delivery reports out of the mailboxes campaigns were
 * sent from and adds the permanently dead addresses to the register. A
 * back-book built over years carries addresses that stopped working long
 * ago; without this, each one costs a send every time it matches a
 * segment, and the sending domain's reputation pays for it.
 *
 * Runs after the hourly campaign cron has had a night to drain, so a
 * campaign sent yesterday has bounced before we look.
 *
 * Requires the Mail.Read application permission on the same Entra app
 * registration that already holds Mail.Send. Without it the run reports
 * needsConsent and changes nothing.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  /* Fail closed, matching api/cron/daily. An unset secret used to skip
     the check entirely, which left bounce reconciliation callable by
     anyone — api/cron/ is excluded from the Auth.js proxy, so this is
     the only gate there is. Compared in constant time because the
     comparison is against a secret. */
  {
    const auth = req.headers.get("authorization");
    if (!cronSecret || !timingSafeEqualStr(auth ?? "", `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await reconcileBounces();

  await auditLog({
    actor: { type: "system" },
    action: "cron.bounces.run",
    meta: { ...result, gated: Boolean(cronSecret) },
  });

  return NextResponse.json({ ok: true, ...result });
}

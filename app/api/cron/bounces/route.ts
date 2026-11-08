import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/constant-time";
import { auditLog } from "@/lib/audit";
import { reconcileBounces } from "@/lib/campaigns/reconcile-bounces";
import { reconcileUnsubscribeMail } from "@/lib/campaigns/reconcile-unsubscribes";

/**
 * Hourly bounce reconciliation, and unsubscribe requests sent by email.
 *
 * Reads recent non-delivery reports out of the mailboxes campaigns were
 * sent from and adds the permanently dead addresses to the register. A
 * back-book built over years carries addresses that stopped working long
 * ago; without this, each one costs a send every time it matches a
 * segment, and the sending domain's reputation pays for it.
 *
 * Hourly rather than per-tick because a non-delivery report takes
 * minutes to hours to come back — checking every five minutes would
 * mostly read an empty mailbox, and a dead address costs nothing to
 * catch an hour late.
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

  /* Unsubscribe requests that arrived as email, on the same hourly
     pass: the same mailboxes, the same Mail.Read permission. Its own
     try so a failure here never hides the bounce result. */
  let unsubscribes: Awaited<ReturnType<typeof reconcileUnsubscribeMail>> | { error: string };
  try {
    unsubscribes = await reconcileUnsubscribeMail();
    await auditLog({
      actor: { type: "system" },
      action: "cron.unsubscribe_mail.run",
      meta: { ...unsubscribes },
    });
  } catch (err) {
    console.error("[cron] unsubscribe mail failed", err);
    unsubscribes = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ ok: true, ...result, unsubscribes });
}

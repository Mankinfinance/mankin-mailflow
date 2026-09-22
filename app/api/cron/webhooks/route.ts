import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/constant-time";
import { auditLog } from "@/lib/audit";
import { drainWebhooks } from "@/lib/webhooks/dispatch";

/**
 * Deliver queued webhooks.
 *
 * Events are queued the instant they happen and delivered from here,
 * never inline. An unsubscribe has to be recorded in milliseconds
 * whether or not somebody's CRM is up, and an HTTP call inside that
 * path would make the slowest receiver the speed of the thing a
 * customer is waiting on.
 *
 * Each pass takes whatever is due, including retries whose backoff has
 * expired. On a daily schedule the first attempt of an event can wait
 * a day, which is the Hobby-plan cost — sub-daily crons are rejected
 * at deploy time. Worth revisiting on Pro, where this wants to run
 * every few minutes.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  /* Fail closed, like every other cron here: api/cron/ is excluded
     from the Auth.js proxy, so this check is the only gate. Constant
     time because it compares against a secret. */
  const auth = req.headers.get("authorization");
  if (!cronSecret || !timingSafeEqualStr(auth ?? "", `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainWebhooks();

  await auditLog({
    actor: { type: "system" },
    action: "webhooks.drain",
    meta: { ...result },
  });

  return NextResponse.json({ ok: true, ...result });
}

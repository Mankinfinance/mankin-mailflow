import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/constant-time";
import { auditLog } from "@/lib/audit";
import { tickAutomations } from "@/lib/automations/runner";

/**
 * Automation tick.
 *
 * Runs hourly: enrols contacts whose trigger fired, then advances every
 * run whose wait has expired. Hourly rather than daily because a
 * sequence's steps are measured in days but its transitions are not —
 * a contact who opens at 9am should reach the next step that morning,
 * not the following night.
 *
 * Gated on CRON_SECRET like the other crons.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  /* Fail closed, matching api/cron/daily. An unset secret used to skip
     the check entirely, which left automation tick callable by
     anyone — api/cron/ is excluded from the Auth.js proxy, so this is
     the only gate there is. Compared in constant time because the
     comparison is against a secret. */
  {
    const auth = req.headers.get("authorization");
    if (!cronSecret || !timingSafeEqualStr(auth ?? "", `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await tickAutomations();

  await auditLog({
    actor: { type: "system" },
    action: "cron.automations.run",
    meta: { ...result, gated: Boolean(cronSecret) },
  });

  return NextResponse.json({ ok: true, ...result });
}

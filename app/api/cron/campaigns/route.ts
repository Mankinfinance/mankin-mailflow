import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/constant-time";
import { auditLog } from "@/lib/audit";
import { decideDueAbTests, dispatchDueCampaigns } from "@/lib/campaigns/send";

/**
 * Campaign dispatch cron.
 *
 * Runs hourly (vercel.json) and sends one batch per due campaign — those
 * a broker has started, and those scheduled for a time that has passed.
 * A large back-book blast therefore goes out over several hours rather
 * than in one burst, which is what keeps it inside Exchange Online's
 * per-mailbox send rate.
 *
 * Gated on CRON_SECRET like the other crons, and excluded from the
 * Auth.js proxy by the api/cron/ matcher rule in proxy.ts.
 */

export const dynamic = "force-dynamic";
/* Sends are sequential Graph calls; the run budget in lib/campaigns/send.ts
   is sized against this ceiling. */
export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  /* Fail closed, matching api/cron/daily. An unset secret used to skip
     the check entirely, which left campaign dispatch callable by
     anyone — api/cron/ is excluded from the Auth.js proxy, so this is
     the only gate there is. Compared in constant time because the
     comparison is against a secret. */
  {
    const auth = req.headers.get("authorization");
    if (!cronSecret || !timingSafeEqualStr(auth ?? "", `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  /* Decide before dispatching, so a test called this tick starts
     sending its holdback in the same tick rather than waiting for the
     next one. */
  const decided = await decideDueAbTests();

  const results = await dispatchDueCampaigns();

  const totals = results.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
    }),
    { sent: 0, failed: 0, skipped: 0 },
  );

  await auditLog({
    actor: { type: "system" },
    action: "cron.campaigns.run",
    meta: {
      campaigns: results.length,
      ...totals,
      abDecided: decided.length,
      gated: Boolean(cronSecret),
    },
  });

  return NextResponse.json({
    ok: true,
    campaigns: results.length,
    ...totals,
    results,
    abDecided: decided,
  });
}

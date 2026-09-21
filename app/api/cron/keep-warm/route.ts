import { NextResponse } from "next/server";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";

/**
 * Keep-warm cron - hits the Sydney lambda every 4 minutes during AEST
 * business hours so the dashboard never serves a cold start to the
 * broker who opens it first thing in the morning.
 *
 * Schedule (vercel.json): every 4 minutes between 22:00 UTC and 10:00
 * UTC (= 8am to 8pm AEST), every day. Outside that window the lambda
 * is allowed to sleep; the first dashboard load of the day takes ~1s
 * but that's once, not every visit.
 *
 * Does real work (listDeals) so it warms three layers at once:
 *   1. The Vercel function process (Node.js startup + module load)
 *   2. The Drizzle/Supabase connection pool
 *   3. The deal repo / Salestrekker mock cache
 *
 * Doesn't write anything. Returns a tiny payload so the cron's audit
 * trail is cheap.
 *
 * Gated on CRON_SECRET like every other cron.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  // Fail closed: require CRON_SECRET to be set AND the caller to present it.
  // Vercel adds `Authorization: Bearer <CRON_SECRET>` to cron invocations
  // automatically once the env var is set. An unset secret is now a 401.
  {
    const auth = req.headers.get("authorization");
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const t0 = Date.now();
  let dealCount = 0;
  try {
    const client = getSalestrekkerClient();
    const deals = await client.listDeals();
    dealCount = deals.length;
  } catch (err) {
    /* Even on error the lambda + connection pool got warmed - that's
       the point. Log + continue so the cron status stays OK. */
    console.warn("[cron keep-warm] listDeals threw", err);
  }

  return NextResponse.json({
    ok: true,
    warmedMs: Date.now() - t0,
    dealCount,
  });
}

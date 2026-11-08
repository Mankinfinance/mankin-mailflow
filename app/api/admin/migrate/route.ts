import { NextResponse } from "next/server";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { auditLog } from "@/lib/audit";
import { applyMigrations, migrationUrl } from "@/lib/db/auto-migrate";

/**
 * Apply pending database migrations, from a button rather than a
 * terminal.
 *
 * Every schema change this app has ever needed has been checked into
 * `drizzle/` by the time it ships. The only thing standing between a
 * deploy and a working database is somebody running one command, and
 * "somebody" is a mortgage broker rather than a release engineer. So
 * this runs the same migrations the CLI would, gated on an admin
 * session.
 *
 * It cannot run arbitrary SQL. It applies the files in the repo, in
 * order, skipping those already recorded in `__drizzle_migrations` —
 * exactly what `pnpm db:migrate` does. Running it twice is a no-op,
 * which is the property that makes a button safe.
 *
 * POST only. A GET would be followed by link prefetchers, bots and the
 * browser's own address-bar guessing, and a schema change is not
 * something that should happen because something crawled a URL.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return NextResponse.json(
      { ok: false, error: "Admin access required." },
      { status: 403 },
    );
  }

  if (!migrationUrl()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No DATABASE_URL is set, so there is no database to migrate. Mailflow is running on in-memory storage.",
      },
      { status: 400 },
    );
  }

  /* The same code the deploy step and the dashboard's self-repair use,
     so the button and the automatic path can't drift apart. */
  const result = await applyMigrations();
  if (result.ok) {
    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "db.migrate",
      meta: { ms: result.ms },
    });
    return NextResponse.json({
      ok: true,
      message: "Migrations applied. Anything already applied was skipped.",
      ms: result.ms,
    });
  }
  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "db.migrate.failed",
    meta: { error: result.error.slice(0, 500) },
  });
  return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
}

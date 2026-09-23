import { NextResponse } from "next/server";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { auditLog } from "@/lib/audit";

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

/**
 * Migrations prefer a direct connection, though less urgently than an
 * earlier version of this comment claimed.
 *
 * That version said drizzle takes a session-level advisory lock which
 * the transaction-mode pooler would break. It does not take one — see
 * pg-core's dialect.migrate: it creates the tracking table, reads the
 * most recently applied row, and replays everything newer inside a
 * single transaction. No lock, and because Postgres has transactional
 * DDL, no half-applied schema either. It is all-or-nothing.
 *
 * What remains is duller and real: a migration is one long transaction,
 * and a pooler is tuned for short ones. Statement and idle timeouts are
 * the thing that bites, especially on a first run applying twenty-odd
 * files at once. Supabase recommends the direct connection for this for
 * that reason.
 *
 * So MIGRATE_DATABASE_URL is used when set and DATABASE_URL otherwise —
 * a fallback rather than a requirement, because on a database with no
 * pooler in front of it they are the same string.
 */
function migrationUrl(): string | null {
  return process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

export async function POST() {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return NextResponse.json(
      { ok: false, error: "Admin access required." },
      { status: 403 },
    );
  }

  const url = migrationUrl();
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No DATABASE_URL is set, so there is no database to migrate. Mailflow is running on in-memory storage.",
      },
      { status: 400 },
    );
  }

  /* A connection of its own, closed at the end. The app's pooled
     client is a long-lived singleton tuned for many short queries;
     migrations are one long one, and should not be holding a slot in
     that pool while they run. `max: 1` because the migrator is
     sequential and a second connection would only sit idle. */
  const client = postgres(url, { max: 1, prepare: false });

  try {
    const db = drizzle(client);
    const startedAt = Date.now();
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const ms = Date.now() - startedAt;

    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "db.migrate",
      meta: { ms },
    });

    return NextResponse.json({
      ok: true,
      message: "Migrations applied. Anything already applied was skipped.",
      ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auditLog({
      actor: { type: "broker", id: broker.id },
      action: "db.migrate.failed",
      meta: { error: message.slice(0, 500) },
    });
    return NextResponse.json(
      { ok: false, error: message.slice(0, 1000) },
      { status: 500 },
    );
  } finally {
    /* Always closed. A serverless instance can be reused, and a
       migration connection left open would hold a backend slot on a
       database that has a small, finite number of them. */
    await client.end({ timeout: 5 });
  }
}

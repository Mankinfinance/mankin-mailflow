import "server-only";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applying the database updates in drizzle/, from inside the app.
 *
 * Used by the Set up the tables button (/api/admin/migrate) and, as a
 * backstop to the deploy step (scripts/migrate-on-deploy.mjs), by pages
 * that find a table or column missing: they apply the updates once and
 * try again, instead of telling a broker to press a button.
 *
 * Applies only the files that shipped with the build, skipping any
 * already recorded, so running it again is a no-op.
 */

/** The direct connection when there is one: a migration is one long
 *  transaction, and a pooler is tuned for short ones. */
export function migrationUrl(): string | null {
  return process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

export type MigrateResult = { ok: true; ms: number } | { ok: false; error: string };

export async function applyMigrations(): Promise<MigrateResult> {
  const url = migrationUrl();
  if (!url || process.env.MOCK_DB === "true") {
    return { ok: false, error: "No database is connected, so there is nothing to set up." };
  }
  /* A connection of its own, always closed: the app's pool is for short
     queries, and a serverless instance can be reused. */
  const client = postgres(url, { max: 1, prepare: false });
  try {
    const startedAt = Date.now();
    await migrate(drizzle(client), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    return { ok: true, ms: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) };
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}

let attempt: Promise<boolean> | null = null;

/** Apply the updates at most once per server instance; every caller
 *  that hits a missing table at the same moment waits on the same run. */
export function migrateOnce(): Promise<boolean> {
  attempt ??= applyMigrations().then((r) => {
    if (r.ok) console.warn(`[auto-migrate] database was behind; updates applied in ${r.ms} ms`);
    else console.error(`[auto-migrate] couldn't apply database updates: ${r.error}`);
    return r.ok;
  });
  return attempt;
}

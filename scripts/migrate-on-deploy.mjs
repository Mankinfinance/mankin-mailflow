/**
 * Applies the database updates in drizzle/ as part of a production
 * deploy, so nobody has to press "Set up the tables" after an update.
 *
 * Runs before `next build` (see package.json). Only on Vercel's
 * production builds: preview builds share the production database, and
 * a branch's half-finished migration must not reach it; local and CI
 * builds have no database. Set MIGRATE_ON_DEPLOY=false in Vercel to
 * turn it off.
 *
 * What happens when it can't:
 *  - A migration fails: the build fails, and Vercel keeps the previous
 *    version live. The new code expects the new schema, so shipping it
 *    without one is what broke the dashboard; not shipping it is safe.
 *    Nothing is half-applied: drizzle runs them in one transaction.
 *  - The database can't be reached: the build carries on, with a
 *    warning. Holding every deploy hostage to a database blip is worse,
 *    and the app applies them itself on first use (lib/db/auto-migrate).
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
const skip =
  process.env.VERCEL_ENV !== "production"
    ? `not a production deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
    : process.env.MIGRATE_ON_DEPLOY === "false"
      ? "MIGRATE_ON_DEPLOY=false"
      : process.env.MOCK_DB === "true"
        ? "MOCK_DB=true"
        : !url
          ? "no DATABASE_URL"
          : null;

if (skip) {
  console.log(`[migrate-on-deploy] skipped: ${skip}`);
  process.exit(0);
}

const UNREACHABLE = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN",
  "CONNECT_TIMEOUT", "57P03", "53300", "28P01", "28000",
]);

const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
const started = Date.now();
try {
  await client`select 1`;
} catch (err) {
  console.warn(
    `[migrate-on-deploy] database not reachable (${err?.code ?? err?.message}); deploying anyway, the app will apply updates on first use.`,
  );
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}
try {
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  console.log(`[migrate-on-deploy] database up to date (${Date.now() - started} ms)`);
} catch (err) {
  const code = err?.code ?? err?.cause?.code;
  if (UNREACHABLE.has(code)) {
    console.warn(`[migrate-on-deploy] lost the database mid-way (${code}); deploying anyway.`);
  } else {
    console.error("[migrate-on-deploy] a database update failed, so this deploy is stopped and the previous version stays live:");
    console.error(err);
    process.exitCode = 1;
  }
} finally {
  await client.end({ timeout: 5 }).catch(() => {});
}

import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit config — runs `pnpm db:generate` to produce migration SQL,
 * `pnpm db:migrate` to apply, `pnpm db:studio` to browse the DB.
 *
 * In mock mode (no DATABASE_URL set) you can still run `db:generate` to
 * keep migrations up to date; only `db:migrate` and `db:studio` need a
 * real connection.
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder",
  },
  // Keep snapshots in repo so contributors don't need a real DB to diff.
  verbose: true,
  strict: true,
} satisfies Config;

import "server-only";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";
import { Table, getTableName, isTable } from "drizzle-orm";

/**
 * What the database is actually doing on this deployment.
 *
 * This exists because "is my data being kept" turned out to be a
 * question nobody could answer from the outside. The app runs happily
 * without a database — the repos fall back to in-memory Maps — so a
 * misconfigured deployment looks identical to a working one until a
 * week's work disappears on the next deploy. Every signal that
 * distinguishes the two is gathered here, in one place, so the answer
 * can be shown rather than inferred.
 *
 * It reads env vars, the shipped migration files, and (optionally) the
 * database itself. Nothing here returns a connection string or any
 * part of one.
 */

/** Every table the schema expects to exist once migrations have run. */
const schemaExports: unknown[] = Object.values(schema);
export const EXPECTED_TABLES: string[] = schemaExports
  .filter((v): v is Table => isTable(v))
  .map((t) => getTableName(t))
  .sort();

export interface DatabaseConfig {
  /** DATABASE_URL is set on this deployment. */
  hasUrl: boolean;
  /** MOCK_DB=true, which forces in-memory storage even with a URL set. */
  forcedMock: boolean;
  /** Whether writes are actually being kept. Both of the above decide it. */
  persisting: boolean;
  /** Migrations would run over the connection pooler rather than direct. */
  usingPoolerForMigrations: boolean;
  /** MIGRATE_DATABASE_URL is set. */
  hasMigrateUrl: boolean;
  /** How many .sql files this build shipped in drizzle/. */
  migrationFilesShipped: number;
  /** How many tables the schema expects. */
  tablesExpected: number;
  /** Short commit this build was made from, when Vercel supplies it. */
  commit: string | null;
  /** production / preview / development, per Vercel. */
  deployEnv: string | null;
}

/**
 * The half that needs no database connection. Safe to call from any
 * server component; it touches env vars and the filesystem only.
 */
export function databaseConfig(): DatabaseConfig {
  const url = process.env.DATABASE_URL ?? "";
  const hasUrl = url.trim().length > 0;
  const forcedMock = process.env.MOCK_DB === "true";
  const hasMigrateUrl = Boolean(process.env.MIGRATE_DATABASE_URL?.trim());

  return {
    hasUrl,
    forcedMock,
    persisting: hasUrl && !forcedMock,
    usingPoolerForMigrations: !hasMigrateUrl && url.includes("pooler"),
    hasMigrateUrl,
    migrationFilesShipped: countMigrationFiles(),
    tablesExpected: EXPECTED_TABLES.length,
    commit: shortCommit(),
    deployEnv: process.env.VERCEL_ENV ?? null,
  };
}

/**
 * Counting the files matters more than it looks. The migrate route runs
 * whatever is in `drizzle/` at runtime, and a serverless function only
 * ships the files the tracer knows it needs — so a build that forgot to
 * include them would report a successful migration having applied
 * nothing at all. A count of zero here is that failure, named.
 */
function countMigrationFiles(): number {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "drizzle"))
      .filter((f) => f.endsWith(".sql")).length;
  } catch {
    return 0;
  }
}

function shortCommit(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : null;
}

export interface DatabaseProbe {
  reachable: boolean;
  /** Why not, when unreachable. Postgres messages name no credentials. */
  error: string | null;
  /** Tables from the schema that exist in the database right now. */
  tablesPresent: string[];
  /** Tables the schema expects that are not there yet. */
  tablesMissing: string[];
  /** Rows in drizzle.__drizzle_migrations — 0 before the first run. */
  migrationsRecorded: number;
  /** When the most recent migration was applied. */
  lastMigrationAt: Date | null;
}

/**
 * The half that needs a connection. Opens one, asks two questions,
 * closes it. Never reuses the app's pooled client: this runs on a
 * diagnostics page that may well be loaded precisely because the pool
 * is the thing that is broken.
 */
export async function probeDatabase(): Promise<DatabaseProbe> {
  const empty = {
    tablesPresent: [],
    tablesMissing: EXPECTED_TABLES,
    migrationsRecorded: 0,
    lastMigrationAt: null,
  };

  const url = process.env.DATABASE_URL;
  if (!url) {
    return { reachable: false, error: "No DATABASE_URL is set.", ...empty };
  }

  const client = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });

  try {
    const present = await client<{ table_name: string }[]>`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_type = 'BASE TABLE'
    `;
    const names = new Set(present.map((r) => r.table_name));

    /* The tracking table is absent until the first migration runs, and
       asking for rows from a table that does not exist is an error
       rather than an empty result — so check for it first. */
    let migrationsRecorded = 0;
    let lastMigrationAt: Date | null = null;
    const tracking = await client<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
         where table_schema = 'drizzle'
           and table_name = '__drizzle_migrations'
      ) as exists
    `;
    if (tracking[0]?.exists) {
      const rows = await client<{ count: string; latest: string | null }[]>`
        select count(*)::text as count, max(created_at)::text as latest
          from drizzle.__drizzle_migrations
      `;
      migrationsRecorded = Number(rows[0]?.count ?? 0);
      /* created_at holds the migration folder's millisecond timestamp,
         stored as a bigint rather than a date. */
      const latest = rows[0]?.latest;
      lastMigrationAt = latest ? new Date(Number(latest)) : null;
    }

    return {
      reachable: true,
      error: null,
      tablesPresent: EXPECTED_TABLES.filter((t) => names.has(t)),
      tablesMissing: EXPECTED_TABLES.filter((t) => !names.has(t)),
      migrationsRecorded,
      lastMigrationAt,
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
      ...empty,
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

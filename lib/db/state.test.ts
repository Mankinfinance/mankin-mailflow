import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { databaseConfig, EXPECTED_TABLES } from "./state";

/**
 * These assert the decisions the settings panel makes, because getting
 * one of them backwards means telling a broker their data is safe when
 * it is not.
 */

const KEEP = { ...process.env };

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.MIGRATE_DATABASE_URL;
  delete process.env.MOCK_DB;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  process.env = { ...KEEP };
});

describe("EXPECTED_TABLES", () => {
  it("lists every table in the schema", () => {
    // If this drops, a table stopped being exported from schema.ts and
    // the database page would quietly stop checking for it.
    expect(EXPECTED_TABLES.length).toBeGreaterThanOrEqual(39);
    expect(EXPECTED_TABLES).toContain("campaigns");
    expect(EXPECTED_TABLES).toContain("settlements");
    expect(EXPECTED_TABLES).toContain("survey_responses");
  });

  it("is sorted and free of duplicates", () => {
    expect([...EXPECTED_TABLES].sort()).toEqual(EXPECTED_TABLES);
    expect(new Set(EXPECTED_TABLES).size).toBe(EXPECTED_TABLES.length);
  });
});

describe("databaseConfig", () => {
  it("reports no database when DATABASE_URL is unset", () => {
    const c = databaseConfig();
    expect(c.hasUrl).toBe(false);
    expect(c.persisting).toBe(false);
  });

  it("treats a blank DATABASE_URL as unset", () => {
    process.env.DATABASE_URL = "   ";
    expect(databaseConfig().hasUrl).toBe(false);
  });

  it("persists when a URL is set", () => {
    process.env.DATABASE_URL = "postgres://u:p@db.example.com:5432/postgres";
    const c = databaseConfig();
    expect(c.hasUrl).toBe(true);
    expect(c.persisting).toBe(true);
    expect(c.forcedMock).toBe(false);
  });

  it("does not persist when MOCK_DB forces mock despite a URL", () => {
    // The trap: everything looks configured and nothing is written.
    process.env.DATABASE_URL = "postgres://u:p@db.example.com:5432/postgres";
    process.env.MOCK_DB = "true";
    const c = databaseConfig();
    expect(c.hasUrl).toBe(true);
    expect(c.forcedMock).toBe(true);
    expect(c.persisting).toBe(false);
  });

  it("only treats the literal string true as forcing mock", () => {
    process.env.DATABASE_URL = "postgres://u:p@db.example.com:5432/postgres";
    process.env.MOCK_DB = "false";
    expect(databaseConfig().persisting).toBe(true);
  });

  it("flags the pooler only when no direct URL is configured", () => {
    process.env.DATABASE_URL =
      "postgres://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";
    expect(databaseConfig().usingPoolerForMigrations).toBe(true);

    process.env.MIGRATE_DATABASE_URL =
      "postgres://u:p@db.abcdef.supabase.co:5432/postgres";
    const c = databaseConfig();
    expect(c.usingPoolerForMigrations).toBe(false);
    expect(c.hasMigrateUrl).toBe(true);
  });

  it("counts the migration files this build shipped", () => {
    // Zero means the drizzle/ folder did not travel with the function,
    // which would make a migration run report success having done
    // nothing.
    expect(databaseConfig().migrationFilesShipped).toBeGreaterThan(0);
  });

  it("shortens the commit and reports the deploy environment", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef";
    process.env.VERCEL_ENV = "production";
    const c = databaseConfig();
    expect(c.commit).toBe("0123456");
    expect(c.deployEnv).toBe("production");
  });

  it("reports an unknown commit off Vercel rather than guessing", () => {
    expect(databaseConfig().commit).toBeNull();
  });
});

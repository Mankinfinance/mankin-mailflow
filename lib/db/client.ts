import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Real Postgres client (Supabase compatible).
 *
 * Only constructed when MOCK_DB=false. In mock mode the repos in
 * lib/db/repos/* use in-memory Maps and never call this.
 *
 * Connection string format (Supabase pooler):
 *   postgres://postgres.<project>:<password>@<region>.pooler.supabase.com:6543/postgres
 */

export type Db = PostgresJsDatabase<typeof schema>;

let cached: { client: postgres.Sql; db: Db } | null = null;

export function getDb(): Db {
  if (cached) return cached.db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL missing. Set it in web/.env.local or flip MOCK_DB=true.",
    );
  }

  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });
  cached = { client, db };
  return db;
}

export { schema };

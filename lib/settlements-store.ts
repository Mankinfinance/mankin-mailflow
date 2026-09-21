import "server-only";
import { desc, eq, sql, notInArray } from "drizzle-orm";
import { getDb } from "./db/client";
import {
  settlements as settlementsTable,
  settlementImports as settlementImportsTable,
  settlementReviews as settlementReviewsTable,
} from "./db/schema";
import type { SettlementRow } from "./commission-parser";

/**
 * Persistent store for the back-book of settled deals + their review
 * touchpoints. Mirrors the pattern in imported-deals-store.ts:
 *
 *  - Postgres-backed via Drizzle when DATABASE_URL is set
 *  - Falls back to an in-memory Map when MOCK_DB is true OR the
 *    settlements table doesn't exist (so the page renders even before
 *    the migration runs)
 *
 * Module-level so the fallback persists across requests within a
 * single Vercel container's lifetime.
 */

/* -------------------------------------------------------------------------- */
/* Fallback in-memory store                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Pinned to globalThis rather than held in module-level variables.
 *
 * Next hands route handlers a different module instance from pages, so
 * a module-level Map is a *different* store in each — settlements
 * imported through one would be invisible to the other. The repo bundle
 * had the same bug (see lib/db/repos.ts); this is the other half of it.
 * Real Postgres hides it because both instances read the same database,
 * so it only shows up in mock mode. Pinning here also survives dev
 * hot-reload, which the module-level version did not.
 */
const FALLBACK_KEY = Symbol.for("mankin.settlements.fallback");

interface SettlementFallback {
  settlements: Map<string, SettlementRow>;
  lastImport: SettlementImportMeta | null;
  reviews: SettlementReview[];
}

function fallbackStore(): SettlementFallback {
  const store = globalThis as typeof globalThis & {
    [FALLBACK_KEY]?: SettlementFallback;
  };
  store[FALLBACK_KEY] ??= {
    settlements: new Map<string, SettlementRow>(),
    lastImport: null,
    reviews: [],
  };
  return store[FALLBACK_KEY];
}

function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "42P01" || e.cause?.code === "42P01";
}

/** Use real Postgres whenever a DATABASE_URL is configured. No DB URL →
 *  in-memory fallback. MOCK_DB="true" force-mocks even with a URL set.
 *  Previously this also required MOCK_DB === "false", which meant
 *  attaching a database silently changed nothing and every recorded
 *  review send kept resetting on redeploy. */
function shouldUseMock(): boolean {
  return !process.env.DATABASE_URL || process.env.MOCK_DB === "true";
}

function warnFallback(method: string): void {
  console.warn(
    `[settlements-store] \`settlements\` table missing — using in-memory fallback for ${method}. Run pnpm db:migrate.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Self-heal — auto-create the settlements tables when migration 0003 hasn't  */
/* been run. Idempotent (CREATE TABLE IF NOT EXISTS), so it's safe to call    */
/* on every 42P01 catch. Drizzle's pnpm db:migrate stays compatible because   */
/* the 0003 migration was edited to also use IF NOT EXISTS.                   */
/* -------------------------------------------------------------------------- */

let selfHealAttempted = false;

async function selfHealTables(method: string): Promise<boolean> {
  if (selfHealAttempted) return false; // only one attempt per container
  selfHealAttempted = true;

  console.warn(
    `[settlements-store] auto-creating missing settlements tables (triggered by ${method}). Run pnpm db:migrate to make this permanent.`,
  );

  try {
    const db = getDb();
    // Drizzle's sql\`\` template runs raw SQL. The DDL mirrors migration
    // 0003 exactly, with IF NOT EXISTS so it's safe whether the tables
    // are already there or not.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "settlement_imports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
        "imported_by" text NOT NULL,
        "filename" text NOT NULL,
        "row_count" integer NOT NULL,
        "sheet_counts" text NOT NULL
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "settlement_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "settlement_id" text NOT NULL,
        "milestone" integer NOT NULL,
        "milestone_date" text NOT NULL,
        "state" text NOT NULL,
        "actioned_by" text NOT NULL,
        "note" text
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "settlements" (
        "id" text PRIMARY KEY NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "broker_id" text,
        "settlement_date" text,
        "data" jsonb NOT NULL
      );
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "settlement_imports_imported_at_idx" ON "settlement_imports" USING btree ("imported_at");`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "settlement_reviews_settlement_idx" ON "settlement_reviews" USING btree ("settlement_id");`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "settlement_reviews_milestone_date_idx" ON "settlement_reviews" USING btree ("milestone_date");`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "settlements_broker_id_idx" ON "settlements" USING btree ("broker_id");`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "settlements_settlement_date_idx" ON "settlements" USING btree ("settlement_date");`,
    );
    console.warn(
      "[settlements-store] settlements tables auto-created. Data will now persist across requests.",
    );
    return true;
  } catch (err) {
    console.error(
      "[settlements-store] auto-create failed — falling back to in-memory store. Run pnpm db:migrate manually.",
      err,
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface SettlementImportMeta {
  importedAt: string;
  importedBy: string;
  filename: string;
  rowCount: number;
  sheetCounts: string;
}

export type ReviewState = "booked" | "emailed" | "dismissed" | "skipped";

export interface SettlementReview {
  id: string;
  settlementId: string;
  milestone: number;
  milestoneDate: string;
  state: ReviewState;
  actionedBy: string;
  /** For "skipped" rows this is the ISO date the snooze expires —
   *  after that the touchpoint re-surfaces in the open list. Other
   *  states leave this null. */
  snoozeUntil: string | null;
  note: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Settlement CRUD                                                            */
/* -------------------------------------------------------------------------- */

export async function listSettlements(): Promise<SettlementRow[]> {
  if (shouldUseMock()) {
    return [...fallbackStore().settlements.values()].sort((a, b) =>
      b.settlementDate.localeCompare(a.settlementDate),
    );
  }
  const run = async (): Promise<SettlementRow[]> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(settlementsTable)
      .orderBy(desc(settlementsTable.settlementDate));
    return rows.map((r) => r.data as SettlementRow);
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("listSettlements");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("listSettlements");
      return [...fallbackStore().settlements.values()].sort((a, b) =>
        b.settlementDate.localeCompare(a.settlementDate),
      );
    }
    throw err;
  }
}

export async function getSettlement(id: string): Promise<SettlementRow | null> {
  if (shouldUseMock()) return fallbackStore().settlements.get(id) ?? null;
  const run = async (): Promise<SettlementRow | null> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(settlementsTable)
      .where(eq(settlementsTable.id, id))
      .limit(1);
    return rows[0] ? (rows[0].data as SettlementRow) : null;
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("getSettlement");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("getSettlement");
      return fallbackStore().settlements.get(id) ?? null;
    }
    throw err;
  }
}

/** REPLACE semantics — wipe the back-book then insert the parsed rows.
 *  Mirrors the deals import REPLACE flow so re-uploading a fresh
 *  commission XLSX always reflects the latest data. */
export async function replaceAllSettlements(
  rows: SettlementRow[],
): Promise<number> {
  if (shouldUseMock()) {
    fallbackStore().settlements.clear();
    for (const r of rows) fallbackStore().settlements.set(r.id, r);
    return rows.length;
  }
  const run = async (): Promise<number> => {
    const db = getDb();
    await db.delete(settlementsTable);
    if (rows.length === 0) return 0;
    await db.insert(settlementsTable).values(
      rows.map((r) => ({
        id: r.id,
        brokerId: r.brokerId,
        settlementDate: r.settlementDate || null,
        data: r,
      })),
    );
    return rows.length;
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("replaceAllSettlements");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("replaceAllSettlements");
      fallbackStore().settlements.clear();
      for (const r of rows) fallbackStore().settlements.set(r.id, r);
      return rows.length;
    }
    throw err;
  }
}

export async function clearSettlements(): Promise<void> {
  if (shouldUseMock()) {
    fallbackStore().settlements.clear();
    fallbackStore().lastImport = null;
    return;
  }
  const run = async (): Promise<void> => {
    const db = getDb();
    await db.delete(settlementsTable);
  };
  try {
    await run();
    return;
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("clearSettlements");
      if (healed) {
        try {
          await run();
          return;
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("clearSettlements");
      fallbackStore().settlements.clear();
      fallbackStore().lastImport = null;
      return;
    }
    throw err;
  }
}

export async function countSettlements(): Promise<number> {
  if (shouldUseMock()) return fallbackStore().settlements.size;
  const run = async (): Promise<number> => {
    const db = getDb();
    const rows = await db.select().from(settlementsTable);
    return rows.length;
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("countSettlements");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      return fallbackStore().settlements.size;
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Import session                                                             */
/* -------------------------------------------------------------------------- */

export async function recordSettlementImport(args: {
  importedBy: string;
  filename: string;
  rowCount: number;
  sheetCounts: string;
}): Promise<void> {
  if (shouldUseMock()) {
    fallbackStore().lastImport = {
      importedAt: new Date().toISOString(),
      ...args,
    };
    return;
  }
  const run = async (): Promise<void> => {
    const db = getDb();
    await db.insert(settlementImportsTable).values(args);
  };
  try {
    await run();
    return;
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("recordSettlementImport");
      if (healed) {
        try {
          await run();
          return;
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("recordSettlementImport");
      fallbackStore().lastImport = {
        importedAt: new Date().toISOString(),
        ...args,
      };
      return;
    }
    throw err;
  }
}

export async function getLastSettlementImport(): Promise<SettlementImportMeta | null> {
  if (shouldUseMock()) return fallbackStore().lastImport;
  const run = async (): Promise<SettlementImportMeta | null> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(settlementImportsTable)
      .orderBy(desc(settlementImportsTable.importedAt))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          importedAt: row.importedAt.toISOString(),
          importedBy: row.importedBy,
          filename: row.filename,
          rowCount: row.rowCount,
          sheetCounts: row.sheetCounts,
        }
      : null;
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("getLastSettlementImport");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      return fallbackStore().lastImport;
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Reviews — per (settlement, milestone) tracking                             */
/* -------------------------------------------------------------------------- */

/** Internal: extract snoozeUntil from the encoded note field. */
function decodeNote(raw: string | null): {
  note: string | null;
  snoozeUntil: string | null;
} {
  if (!raw) return { note: null, snoozeUntil: null };
  const m = /^SNOOZE:(\d{4}-\d{2}-\d{2})(?:\|([\s\S]*))?$/.exec(raw);
  if (m) {
    return { snoozeUntil: m[1], note: m[2]?.trim() ? m[2].trim() : null };
  }
  return { note: raw, snoozeUntil: null };
}

/** Internal: encode snoozeUntil into the note field for persistence. */
function encodeNote(args: { note?: string; snoozeUntil?: string | null }): string | null {
  if (args.snoozeUntil) {
    return `SNOOZE:${args.snoozeUntil}${args.note ? `|${args.note}` : ""}`;
  }
  return args.note ?? null;
}

export async function listReviews(): Promise<SettlementReview[]> {
  if (shouldUseMock()) return [...fallbackStore().reviews];
  const run = async (): Promise<SettlementReview[]> => {
    const db = getDb();
    const rows = await db.select().from(settlementReviewsTable);
    return rows.map((r) => {
      const { note, snoozeUntil } = decodeNote(r.note);
      return {
        id: r.id,
        settlementId: r.settlementId,
        milestone: r.milestone,
        milestoneDate: r.milestoneDate,
        state: r.state as ReviewState,
        actionedBy: r.actionedBy,
        snoozeUntil,
        note,
        createdAt: r.createdAt.toISOString(),
      };
    });
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("listReviews");
      if (healed) {
        try {
          return await run();
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      return [...fallbackStore().reviews];
    }
    throw err;
  }
}

export async function recordReview(args: {
  settlementId: string;
  milestone: number;
  milestoneDate: string;
  state: ReviewState;
  actionedBy: string;
  /** For "skipped" state: ISO yyyy-mm-dd date after which the review
   *  re-surfaces in the open list. Default is 14 days from now. */
  snoozeUntil?: string;
  note?: string;
}): Promise<void> {
  const encoded = encodeNote({ note: args.note, snoozeUntil: args.snoozeUntil });
  if (shouldUseMock()) {
    fallbackStore().reviews.push({
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      settlementId: args.settlementId,
      milestone: args.milestone,
      milestoneDate: args.milestoneDate,
      state: args.state,
      actionedBy: args.actionedBy,
      snoozeUntil: args.snoozeUntil ?? null,
      note: args.note ?? null,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  const run = async (): Promise<void> => {
    const db = getDb();
    await db.insert(settlementReviewsTable).values({
      settlementId: args.settlementId,
      milestone: args.milestone,
      milestoneDate: args.milestoneDate,
      state: args.state,
      actionedBy: args.actionedBy,
      note: encoded,
    });
  };
  try {
    await run();
    return;
  } catch (err) {
    if (isMissingRelation(err)) {
      const healed = await selfHealTables("recordReview");
      if (healed) {
        try {
          await run();
          return;
        } catch (retryErr) {
          if (!isMissingRelation(retryErr)) throw retryErr;
        }
      }
      warnFallback("recordReview");
      fallbackStore().reviews.push({
        id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        settlementId: args.settlementId,
        milestone: args.milestone,
        milestoneDate: args.milestoneDate,
        state: args.state,
        actionedBy: args.actionedBy,
        snoozeUntil: args.snoozeUntil ?? null,
        note: args.note ?? null,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    throw err;
  }
}

/** Delete review rows whose settlement is no longer in the back-book
 *  (loans that have dropped off past commission statements). Returns the
 *  number removed. Admin-triggered cleanup; irreversible. */
export async function purgeOrphanedReviews(
  validSettlementIds: string[],
): Promise<number> {
  const validSet = new Set(validSettlementIds);
  if (shouldUseMock()) {
    const kept = fallbackStore().reviews.filter((r) => validSet.has(r.settlementId));
    const removed = fallbackStore().reviews.length - kept.length;
    fallbackStore().reviews.splice(0, fallbackStore().reviews.length, ...kept);
    return removed;
  }
  const run = async (): Promise<number> => {
    const db = getDb();
    // No valid settlements => every review is orphaned; delete all.
    const q =
      validSettlementIds.length === 0
        ? db.delete(settlementReviewsTable)
        : db
            .delete(settlementReviewsTable)
            .where(
              notInArray(settlementReviewsTable.settlementId, validSettlementIds),
            );
    const deleted = await q.returning({ id: settlementReviewsTable.id });
    return deleted.length;
  };
  try {
    return await run();
  } catch (err) {
    if (isMissingRelation(err)) return 0;
    throw err;
  }
}

/** Build a fast lookup: settlementId → milestone → ACTIVE review state.
 *
 * Skipped reviews whose snooze has expired are NOT included — so the
 * anniversary list re-surfaces the touchpoint once 14 days have
 * passed. The audit log still shows the skip in the review log via
 * listReviews() directly. */
export async function reviewIndex(): Promise<
  Map<string, Map<number, SettlementReview>>
> {
  const all = await listReviews();
  const out = new Map<string, Map<number, SettlementReview>>();
  const todayIso = new Date().toISOString().slice(0, 10);
  // Latest review wins per (settlement, milestone) so a "dismissed"
  // can later be "booked" without losing the trail.
  for (const r of [...all].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    // Skipped review whose snooze has elapsed → treat as not-actioned.
    if (
      r.state === "skipped" &&
      r.snoozeUntil &&
      r.snoozeUntil <= todayIso
    ) {
      // Don't add to the active-hide index. The audit log (review log
      // page) still shows it via listReviews().
      continue;
    }
    let bucket = out.get(r.settlementId);
    if (!bucket) {
      bucket = new Map();
      out.set(r.settlementId, bucket);
    }
    bucket.set(r.milestone, r);
  }
  return out;
}

/** Used by the test harness only. */
export function _resetFallbackForTests(): void {
  fallbackStore().settlements.clear();
  fallbackStore().reviews.length = 0;
  fallbackStore().lastImport = null;
}

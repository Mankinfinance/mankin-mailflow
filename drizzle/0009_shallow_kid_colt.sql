-- Daily pipeline snapshots — one row per calendar day of per-stage deal
-- counts, so the Pipeline overview can show a real "Previous Week" column
-- and week-on-week change. Written by the /api/cron/snapshot cron.
--
-- Only this table is new. Earlier migrations (0003-0007) were hand-authored
-- with CREATE TABLE IF NOT EXISTS and never refreshed the drizzle meta
-- snapshot, so `drizzle-kit generate` re-emits those existing tables; that
-- noise is intentionally omitted here. The regenerated 0008 meta snapshot
-- does capture the full schema, which stops future generates from drifting.
CREATE TABLE IF NOT EXISTS "pipeline_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_date" text NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_snapshots_date_idx" ON "pipeline_snapshots" USING btree ("snapshot_date");
--> statement-breakpoint
-- Keep the invariant from 0008_enable_rls: every public table has RLS on.
-- No policies -> denies all access to non-owner roles, closing the Supabase
-- Data API. The app connects as the table owner (BYPASSRLS) so it is unaffected.
ALTER TABLE "pipeline_snapshots" ENABLE ROW LEVEL SECURITY;

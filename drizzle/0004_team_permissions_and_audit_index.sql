-- Per-team-member permission overrides. When a row exists for a team
-- id, the booleans here override the hardcoded defaults in
-- lib/auth/permissions.ts. Missing rows fall back to defaults.
CREATE TABLE IF NOT EXISTS "team_permissions" (
	"team_id" text PRIMARY KEY NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"can_access_cx" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint

-- Speed up the freshness lookup the deal drawer fires on every open.
-- Was triggering a full audit_log scan when deals had received docs,
-- which got progressively slower as the audit log grew. With this
-- index Postgres can jump straight to the matching rows for one deal.
CREATE INDEX IF NOT EXISTS "audit_log_deal_action_time_idx"
	ON "audit_log" USING btree ("deal_id", "action", "created_at" DESC);

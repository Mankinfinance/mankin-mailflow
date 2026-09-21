CREATE TABLE IF NOT EXISTS "referrers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"leads_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrers_token_hash_idx" ON "referrers" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrers_created_by_idx" ON "referrers" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrers_is_active_idx" ON "referrers" ("is_active");

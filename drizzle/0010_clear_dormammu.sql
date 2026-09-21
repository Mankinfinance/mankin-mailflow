CREATE TABLE IF NOT EXISTS "lender_slas" (
	"lender_id" text PRIMARY KEY NOT NULL,
	"purchase_assess_days" integer,
	"refinance_assess_days" integer,
	"pre_approval_days" integer,
	"formal_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
-- Keep the invariant from 0008_enable_rls: every public table has RLS on.
ALTER TABLE "lender_slas" ENABLE ROW LEVEL SECURITY;

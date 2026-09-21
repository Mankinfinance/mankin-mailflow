CREATE TABLE IF NOT EXISTS "settlement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" text NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL,
	"sheet_counts" text NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broker_id" text,
	"settlement_date" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_imports_imported_at_idx" ON "settlement_imports" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_reviews_settlement_idx" ON "settlement_reviews" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_reviews_milestone_date_idx" ON "settlement_reviews" USING btree ("milestone_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_broker_id_idx" ON "settlements" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_settlement_date_idx" ON "settlements" USING btree ("settlement_date");

CREATE TABLE "deal_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" text NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broker_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deal_imports_imported_at_idx" ON "deal_imports" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX "deals_broker_id_idx" ON "deals" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX "deals_updated_at_idx" ON "deals" USING btree ("updated_at");
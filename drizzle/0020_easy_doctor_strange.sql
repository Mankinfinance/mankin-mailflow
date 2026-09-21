CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"filter" jsonb NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audience_segments_name_idx" ON "audience_segments" USING btree ("name");--> statement-breakpoint
ALTER TABLE "audience_segments" ENABLE ROW LEVEL SECURITY;

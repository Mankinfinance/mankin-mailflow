CREATE TABLE "media_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" text NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"uploaded_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "media_files_created_at_idx" ON "media_files" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "media_files" ENABLE ROW LEVEL SECURITY;

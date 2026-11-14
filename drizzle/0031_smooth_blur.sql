CREATE TABLE IF NOT EXISTS "email_preferences" (
	"email" text PRIMARY KEY NOT NULL,
	"opted_out_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "topic_id" text;--> statement-breakpoint
ALTER TABLE "email_preferences" ENABLE ROW LEVEL SECURITY;
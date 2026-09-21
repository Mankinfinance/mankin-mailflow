CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "email_templates_created_at_idx" ON "email_templates" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;

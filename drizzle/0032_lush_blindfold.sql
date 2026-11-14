CREATE TABLE IF NOT EXISTS "marketing_contacts" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"broker_id" text DEFAULT 'mm' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"consent_note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_contacts_created_at_idx" ON "marketing_contacts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ENABLE ROW LEVEL SECURITY;
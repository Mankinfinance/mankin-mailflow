CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"tag" text NOT NULL,
	"added_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_email_tag_idx" ON "contact_tags" USING btree ("email","tag");--> statement-breakpoint
CREATE INDEX "contact_tags_tag_idx" ON "contact_tags" USING btree ("tag");--> statement-breakpoint
ALTER TABLE "contact_tags" ENABLE ROW LEVEL SECURITY;

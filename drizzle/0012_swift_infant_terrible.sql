CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"fields" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience" jsonb NOT NULL,
	"from_broker_id" text NOT NULL,
	"created_by" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT 'unsubscribe' NOT NULL,
	"campaign_id" uuid,
	"added_by" text DEFAULT 'customer' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_email_idx" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_for_idx" ON "campaigns" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "campaigns_created_by_idx" ON "campaigns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "email_suppressions_created_at_idx" ON "email_suppressions" USING btree ("created_at");--> statement-breakpoint
-- Same posture as 0008_enable_rls: the app connects as the owning
-- `postgres` role (BYPASSRLS), so enabling RLS with no policies closes
-- the Supabase Data API on these tables without affecting LoanFlow.
-- campaign_recipients and email_suppressions hold customer contact
-- details, so they must not be reachable over PostgREST.
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;

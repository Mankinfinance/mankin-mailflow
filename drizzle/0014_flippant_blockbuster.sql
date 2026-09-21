CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"fields" jsonb,
	"status" text DEFAULT 'waiting' NOT NULL,
	"current_node_id" text NOT NULL,
	"node_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "automation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"flow" jsonb NOT NULL,
	"from_broker_id" text NOT NULL,
	"created_by" text NOT NULL,
	"activated_at" timestamp with time zone,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_due_idx" ON "automation_runs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_automation_email_idx" ON "automation_runs" USING btree ("automation_id","email");--> statement-breakpoint
CREATE INDEX "automation_sends_run_idx" ON "automation_sends" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "automation_sends_automation_node_idx" ON "automation_sends" USING btree ("automation_id","node_id");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automations_created_by_idx" ON "automations" USING btree ("created_by");--> statement-breakpoint
-- Same posture as 0008/0012/0013: RLS on, no policies. automation_runs
-- and automation_sends hold customer contact details and must stay off
-- the Supabase Data API.
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_sends" ENABLE ROW LEVEL SECURITY;

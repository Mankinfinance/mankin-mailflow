CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broker_id" text NOT NULL,
	"deal_id" text,
	"task_type" text NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"source" text DEFAULT 'auto' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eod_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deal_id" text NOT NULL,
	"broker_id" text NOT NULL,
	"generation_date" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"ai_source" text DEFAULT 'mock' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"member_id" text NOT NULL,
	"covering_member_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"reason" text,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_settlement_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deal_id" text NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" text,
	"assigned_to" text,
	"draft_subject" text,
	"draft_body" text,
	"draft_source" text DEFAULT 'template' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activities_broker_id_idx" ON "activities" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX "activities_created_at_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activities_task_type_idx" ON "activities" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "eod_briefs_broker_id_idx" ON "eod_briefs" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX "eod_briefs_deal_id_idx" ON "eod_briefs" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "eod_briefs_generation_date_idx" ON "eod_briefs" USING btree ("generation_date");--> statement-breakpoint
CREATE INDEX "eod_briefs_status_idx" ON "eod_briefs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leaves_member_id_idx" ON "leaves" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "leaves_covering_member_id_idx" ON "leaves" USING btree ("covering_member_id");--> statement-breakpoint
CREATE INDEX "leaves_start_at_idx" ON "leaves" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "post_settlement_checkins_deal_id_idx" ON "post_settlement_checkins" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "post_settlement_checkins_status_idx" ON "post_settlement_checkins" USING btree ("status");--> statement-breakpoint
CREATE INDEX "post_settlement_checkins_due_at_idx" ON "post_settlement_checkins" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "post_settlement_checkins_assigned_to_idx" ON "post_settlement_checkins" USING btree ("assigned_to");
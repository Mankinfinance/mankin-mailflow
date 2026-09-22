CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"answers" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_kind" text,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "survey_responses_survey_idx" ON "survey_responses" USING btree ("survey_id");--> statement-breakpoint
CREATE INDEX "survey_responses_submitted_at_idx" ON "survey_responses" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_responses_survey_email_idx" ON "survey_responses" USING btree ("survey_id","email");--> statement-breakpoint
CREATE INDEX "surveys_status_idx" ON "surveys" USING btree ("status");--> statement-breakpoint
ALTER TABLE "surveys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_responses" ENABLE ROW LEVEL SECURITY;
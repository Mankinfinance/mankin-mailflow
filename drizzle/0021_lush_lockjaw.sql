ALTER TABLE "campaign_recipients" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "subject_b" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ab_test_percent" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ab_decide_after_hours" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ab_winner" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ab_decided_at" timestamp with time zone;
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "feedback" text;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "feedback_note" text;

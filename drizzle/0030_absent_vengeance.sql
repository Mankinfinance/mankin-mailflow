ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "consent_status" text DEFAULT 'enquiry' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "consent_text" text;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
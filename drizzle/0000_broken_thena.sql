CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"deal_id" text,
	"meta" jsonb,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "chat_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"messages" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deal_id" text NOT NULL,
	"method" text NOT NULL,
	"success" integer DEFAULT 0 NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "portal_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_deal_id_idx" ON "audit_log" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "chat_transcripts_deal_id_idx" ON "chat_transcripts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "otp_attempts_deal_id_idx" ON "otp_attempts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "otp_attempts_created_at_idx" ON "otp_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portal_tokens_deal_id_idx" ON "portal_tokens" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "portal_tokens_expires_at_idx" ON "portal_tokens" USING btree ("expires_at");
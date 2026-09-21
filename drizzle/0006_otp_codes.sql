-- Adds otp_codes table to persist portal OTP codes across serverless
-- Lambda invocations. The in-memory Map in portal-session.ts only works
-- on a single process; Vercel routes issueOtp and verifyOtp to different
-- Lambdas, so the code was never found on verify.

CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deal_id" text NOT NULL,
  "method" text NOT NULL,
  "code" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "otp_codes_deal_method_uidx" ON "otp_codes" ("deal_id", "method");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_codes_expires_at_idx" ON "otp_codes" ("expires_at");

-- Enables row level security on every table in the public schema.
--
-- Why: Supabase exposes the public schema through PostgREST (the Data
-- API) to the `anon` and `authenticated` roles. With RLS off, anyone
-- holding the project ref and the anon key could read every row. That
-- includes portal_tokens and otp_codes, which together are enough to
-- take over a customer's portal session, plus deals, deal_notes and
-- chat_transcripts, which are customer PII.
--
-- Why this is safe for the app: LoanFlow does not use PostgREST at all.
-- It connects straight to Postgres via DATABASE_URL (lib/db/client.ts)
-- as the `postgres` role, which both owns these tables and carries the
-- BYPASSRLS attribute in Supabase. Owners are exempt from RLS unless
-- FORCE ROW LEVEL SECURITY is set, which it is not here. So enabling
-- RLS closes the Data API without touching the app's own access.
--
-- No policies are created deliberately. RLS enabled with zero policies
-- denies all access to non-bypassing roles, which is exactly what we
-- want for tables that should never be reachable over the Data API.

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portal_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "otp_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_transcripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eod_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_settlement_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_extras" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "referrers" ENABLE ROW LEVEL SECURITY;

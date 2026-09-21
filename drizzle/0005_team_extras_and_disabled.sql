-- Adds:
--   1. team_extras   - runtime-added team members, paired with
--      lib/team-extras.ts. Hardcoded TEAM stays the canonical source
--      for the original Mankin Finance staff; this table holds anyone
--      added later via /dashboard/setup so we don't need a redeploy
--      to onboard a new broker / associate.
--   2. team_permissions.disabled - flips a row to "blocked from
--      LoanFlow". The dashboard layout checks isUserDisabled() on
--      every page load and redirects matching users to /access-revoked.
--      Master Admin (mm) is never disabled; the auth gate refuses to
--      write it.

CREATE TABLE IF NOT EXISTS "team_extras" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"short" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"booking_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint

ALTER TABLE "team_permissions"
	ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL;

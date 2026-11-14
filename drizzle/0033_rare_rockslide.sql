CREATE TABLE IF NOT EXISTS "contact_dates" (
	"email" text NOT NULL,
	"field_id" text NOT NULL,
	"date" date NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_dates_email_field_id_pk" PRIMARY KEY("email","field_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_dates_field_date_idx" ON "contact_dates" USING btree ("field_id","date");--> statement-breakpoint
ALTER TABLE "contact_dates" ENABLE ROW LEVEL SECURITY;
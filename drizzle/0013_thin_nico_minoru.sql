CREATE TABLE "campaign_link_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"first_click_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "campaign_link_clicks_campaign_idx" ON "campaign_link_clicks" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_link_clicks_campaign_url_idx" ON "campaign_link_clicks" USING btree ("campaign_id","url");--> statement-breakpoint
-- Same posture as 0008/0012: RLS on, no policies, so the table is closed
-- to the Supabase Data API while the owning app role bypasses it.
ALTER TABLE "campaign_link_clicks" ENABLE ROW LEVEL SECURITY;

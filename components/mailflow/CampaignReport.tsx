import { Lock } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { Card, Eyebrow, StatGrid, StatTile } from "./MailflowPage";
import { EngagementCurve, type CurvePoint } from "./EngagementCurve";
import type { CampaignStats } from "@/lib/db/repos";
import type { CampaignRecipientRow, CampaignLinkClickRow } from "@/lib/db/schema";

/**
 * Screen 5 — what happened after a send.
 *
 * The editor is gone and the screen says why, rather than leaving
 * someone hunting for a disabled edit button.
 *
 * The tone of "Did not send" is the considered part: two failures in 180
 * is normal at this volume, so it gets a matter-of-fact subhead and no
 * red banner. Findable, not an incident.
 */

export interface CampaignReportProps {
  stats: CampaignStats;
  curve: CurvePoint[];
  links: CampaignLinkClickRow[];
  /**
   * The click map and provider breakdown, rendered here rather than
   * after the whole report — they belong with the engagement figures
   * they explain, above the list of what failed to send.
   */
  insights?: React.ReactNode;
  problems: CampaignRecipientRow[];
  /** Null while a send is still draining. */
  hoursSinceSend: number | null;
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function CampaignReport({
  stats,
  curve,
  links,
  insights,
  problems,
  hoursSinceSend,
}: CampaignReportProps) {
  const failed = problems.filter((p) => p.status === "failed").length;
  const skipped = problems.filter((p) => p.status === "skipped").length;

  return (
    <div className="space-y-3.5">
      <div
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px]"
        style={{
          backgroundColor: "var(--color-paper-warm)",
          borderColor: "#e5d9bd",
          color: "#8a6a22",
        }}
      >
        <Lock size={12} strokeWidth={1.5} />
        Reached customers, so the content is locked
      </div>

      <Card padded={false} className="overflow-hidden">
        <StatGrid>
          <StatTile
            label="Sent"
            value={`${stats.sent}`}
            suffix={`/${stats.total}`}
            note={
              stats.failed + stats.skipped > 0
                ? `${stats.failed + stats.skipped} did not send`
                : "all delivered to the mail server"
            }
          />
          <StatTile
            label="Opened"
            value={`${stats.opened}`}
            suffix={` (${pct(stats.opened, stats.sent)})`}
            tone="var(--color-series-1)"
            note="inflated by image pre-fetch"
          />
          <StatTile
            label="Clicked"
            value={`${stats.clicked}`}
            suffix={` (${pct(stats.clicked, stats.sent)})`}
            tone="var(--color-series-2)"
            note={
              links.length > 0
                ? `${links[0].clicks} took the top link`
                : "no links clicked yet"
            }
          />
          <StatTile
            label="Opted out"
            value={`${stats.unsubscribed}`}
            suffix={` (${pct(stats.unsubscribed, stats.sent)})`}
            note="added to the register"
          />
        </StatGrid>
      </Card>

      {stats.pending > 0 && (
        <p className="text-[12px] text-ink-mute">
          {stats.pending} still queued — the hourly job works through the rest.
        </p>
      )}

      {curve.length > 1 && (
        <Card>
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <Eyebrow>The first 72 hours</Eyebrow>
              <p className="mt-1 text-[11px] text-ink-mute">
                Cumulative opens and clicks. Both indexed to people, so one
                axis carries both.
              </p>
            </div>
            <Legend />
          </div>
          <EngagementCurve points={curve} />
          {hoursSinceSend !== null && hoursSinceSend < 72 && (
            <p className="mt-2 text-[10.5px] text-ink-faint">
              {Math.round(hoursSinceSend)} hours in — the curve fills as the
              window completes.
            </p>
          )}
        </Card>
      )}

      {insights}

      {problems.length > 0 && (
        <Card className="max-w-[560px]">
          <Eyebrow>Did not send</Eyebrow>
          <p className="mt-1 mb-2.5 text-[11px] text-ink-mute">
            {failed} failed
            {skipped > 0 ? `, ${skipped} suppressed` : ""} — normal at this
            volume.
          </p>
          <div className="space-y-2.5">
            {problems.map((p) => (
              <div
                key={p.id}
                className="border-t pt-2.5 first:border-0 first:pt-0"
                style={{ borderColor: "var(--color-hairline-softer)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-ink-soft">
                    {p.email}
                  </span>
                  <StatusPill
                    status={p.status === "skipped" ? "suppressed" : "failed"}
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink-mute">
                  {p.status === "skipped"
                    ? "On the do-not-market list"
                    : "The mail server rejected this address"}
                </p>
                <p
                  className="mono mt-0.5 text-[10.5px]"
                  style={{ color: "var(--color-axis-label)" }}
                >
                  {p.error ?? "not attempted"}
                </p>
              </div>
            ))}
          </div>
          <p
            className="mt-3 rounded-md px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute"
            style={{ backgroundColor: "var(--color-paper)" }}
          >
            Hard bounces are added to the do-not-market register overnight and
            will not be mailed again. Suppressed addresses stay suppressed.
          </p>
        </Card>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {[
        { label: "Opens", colour: "var(--color-series-1)" },
        { label: "Clicks", colour: "var(--color-series-2)" },
      ].map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
          <span
            className="h-0.5 w-3 rounded-full"
            style={{ backgroundColor: s.colour }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

import { Clock } from "lucide-react";
import {
  describeBand,
  describeSendWindow,
  type EngagementBand,
  type EngagementProfile,
  type SendWindow,
} from "@/lib/campaigns/engagement";
import { Eyebrow } from "./MailflowPage";

/**
 * How one contact has behaved, and when they act.
 *
 * Mailchimp puts five stars here. This puts a word and the sentence
 * that earned it, because the only question a broker asks of this panel
 * is "should I keep mailing this person", and a star cannot be argued
 * with. The counts sit underneath so the label can be checked against
 * what it was built from.
 */

const TONE: Record<EngagementBand, { bg: string; ink: string; line: string }> = {
  engaged: { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4" },
  cooling: { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd" },
  dormant: { bg: "#fbf0ef", ink: "#a3423e", line: "#eccfcd" },
  "never-opened": { bg: "#fbf0ef", ink: "#a3423e", line: "#eccfcd" },
  "too-new": { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" },
};

const LABEL: Record<EngagementBand, string> = {
  engaged: "Engaged",
  cooling: "Cooling",
  dormant: "Dormant",
  "never-opened": "Never opened",
  "too-new": "Too new to tell",
};

export function EngagementPanel({
  profile,
  sendWindow,
}: {
  profile: EngagementProfile;
  sendWindow: SendWindow | null;
}) {
  if (profile.received === 0) return null;

  const tone = TONE[profile.band];

  return (
    <>
      <Eyebrow className="mb-2 mt-4">Engagement</Eyebrow>

      <div className="flex items-start gap-2.5">
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
          style={{
            backgroundColor: tone.bg,
            color: tone.ink,
            borderColor: tone.line,
          }}
        >
          {LABEL[profile.band]}
        </span>
        <p className="text-[11.5px] leading-relaxed text-ink-mute">
          {describeBand(profile)}
        </p>
      </div>

      <div className="mt-2.5 flex gap-4">
        <Figure label="Received" value={profile.received} />
        <Figure label="Opened" value={profile.opened} rate={profile.openRate} />
        <Figure label="Clicked" value={profile.clicked} rate={profile.clickRate} />
      </div>

      <p className="mt-2.5 flex gap-1.5 text-[11px] leading-relaxed text-ink-mute">
        <Clock size={12} strokeWidth={1.8} className="mt-px shrink-0 text-ink-faint" />
        {describeSendWindow(sendWindow)}
      </p>
    </>
  );
}

function Figure({
  label,
  value,
  rate,
}: {
  label: string;
  value: number;
  /** Undefined where there is no rate to show; null where it is withheld. */
  rate?: number | null;
}) {
  return (
    <div>
      <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </div>
      <div className="text-[15px] font-semibold tabular-nums text-ink">
        {value}
        {rate !== undefined && rate !== null && (
          <span className="ml-1 text-[11px] font-normal text-ink-mute">
            {rate.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

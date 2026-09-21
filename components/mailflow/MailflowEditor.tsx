"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import {
  previewAudienceAction,
  saveCampaignAction,
  saveSegmentAction,
  sendTestAction,
  startCampaignAction,
  type AudiencePreview,
} from "@/app/(mailflow)/marketing/campaigns/actions";
import { saveCampaignAsTemplateAction } from "@/app/(mailflow)/marketing/templates/actions";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { checkContent, contentVerdict } from "@/lib/campaigns/spam-check";
import type { AudienceFilter } from "@/lib/campaigns/types";
import { AudienceSentence } from "./AudienceSentence";
import { MessagePanel, PanelShell } from "./MessagePanel";
import { ReachRail } from "./ReachRail";

/**
 * Screen 4 — compose the message, compose the audience, understand the
 * consequence, send.
 *
 * The three panels are numbered because they are a sequence, not a set:
 * what it says, who it goes to, what we measure. The rail stays with you
 * through all three.
 */

export interface MailflowEditorProps {
  campaign: {
    id: string;
    name: string;
    subject: string;
    subjectB: string;
    abTestPercent: number;
    body: string;
    fromBrokerId: string;
    audience: AudienceFilter;
    trackOpens: boolean;
    trackClicks: boolean;
  };
  brokers: Array<{ id: string; name: string; short: string; initials: string }>;
  lenderCodes: string[];
  stages: Array<{ id: string; label: string }>;
  allTags: Array<{ tag: string; count: number }>;
  segments: Array<{
    id: string;
    name: string;
    description: string;
    filter: AudienceFilter;
  }>;
  sourceCounts: { settlements: number; deals: number };
  initialPreview: AudiencePreview | null;
}

export function MailflowEditor({
  campaign,
  brokers,
  lenderCodes,
  stages,
  allTags,
  segments,
  sourceCounts,
  initialPreview,
}: MailflowEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(campaign);
  const [preview, setPreview] = React.useState(initialPreview);
  const [recounting, setRecounting] = React.useState(false);
  const [scheduledFor, setScheduledFor] = React.useState("");
  const [status, setStatus] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);
  const [pending, startTransition] = React.useTransition();

  const audience = draft.audience;

  function patch(next: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }
  function patchAudience(next: Partial<AudienceFilter>) {
    setDraft((d) => ({ ...d, audience: { ...d.audience, ...next } }));
  }

  /* The count recomputes as the sentence changes. First run is skipped —
     the server already counted this filter for the initial paint. */
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRecounting(true);
      const result = await previewAudienceAction(audience);
      if (cancelled) return;
      setRecounting(false);
      if (result.ok) setPreview(result.preview);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audience]);

  /* Deliverability check. Warns, never blocks — a false positive that
     stops a legitimate send costs more than a marginal subject line,
     and the broker is better placed than the checker to judge. */
  const contentIssues = React.useMemo(
    () => checkContent({ subject: draft.subject, body: draft.body }),
    [draft.subject, draft.body],
  );

  const unknownFields = React.useMemo(() => {
    const known = new Set<string>(MERGE_FIELDS);
    const found = new Set<string>();
    /* Subject B is checked too — a typo'd merge field there would
       reach half the test group and nobody would see it first. */
    for (const text of [draft.subject, draft.subjectB, draft.body]) {
      for (const m of text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
        const name = m[1].toLowerCase();
        if (!known.has(name)) found.add(name);
      }
    }
    return [...found];
  }, [draft.subject, draft.subjectB, draft.body]);

  async function save(): Promise<boolean> {
    const result = await saveCampaignAction({
      id: draft.id,
      name: draft.name,
      subject: draft.subject,
      subjectB: draft.subjectB,
      abTestPercent: draft.abTestPercent,
      body: draft.body,
      fromBrokerId: draft.fromBrokerId,
      audience: draft.audience,
      trackOpens: draft.trackOpens,
      trackClicks: draft.trackClicks,
    });
    if (!result.ok) setStatus({ tone: "error", text: result.error });
    return result.ok;
  }

  return (
    <div className="flex gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <MessagePanel
          name={draft.name}
          subject={draft.subject}
          body={draft.body}
          fromBrokerId={draft.fromBrokerId}
          subjectB={draft.subjectB}
          abTestPercent={draft.abTestPercent}
          audienceSize={preview?.count ?? 0}
          brokers={brokers}
          unknownFields={unknownFields}
          onChange={patch}
        />

        <PanelShell index={2} label="Audience" note="Reads top to bottom as one instruction">
          <AudienceSentence
            value={audience}
            onChange={patchAudience}
            brokers={brokers}
            lenderCodes={lenderCodes}
            stages={stages}
            counts={sourceCounts}
            allTags={allTags}
            segments={segments}
            onReplace={(filter) => patch({ audience: filter })}
            onSaveSegment={() => {
              const name = window.prompt(
                "Save this audience as a segment. What should it be called?",
                "",
              );
              if (name === null) return;
              startTransition(async () => {
                setStatus(null);
                if (!(await save())) return;
                const result = await saveSegmentAction({
                  name,
                  description: "",
                  filter: draft.audience,
                });
                setStatus(
                  result.ok
                    ? { tone: "ok", text: "Segment saved." }
                    : { tone: "error", text: result.error },
                );
              });
            }}
          />
        </PanelShell>

        <PanelShell
          index={3}
          label="Deliverability"
          note={
            contentVerdict(contentIssues) === "clean"
              ? "Nothing here would trip a filter"
              : undefined
          }
        >
          {contentIssues.length === 0 ? (
            <p className="text-[12px] text-ink-mute">
              Subject, body and links all read the way a filter expects. Every
              send carries a plain-text version, a one-click unsubscribe
              header and your signature automatically.
            </p>
          ) : (
            <ul className="space-y-2">
              {contentIssues.map((issue, i) => (
                <li
                  key={i}
                  className="rounded-md border px-3 py-2"
                  style={
                    issue.severity === "warn"
                      ? { backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }
                      : {
                          backgroundColor: "var(--color-paper)",
                          borderColor: "var(--color-hairline)",
                        }
                  }
                >
                  <p
                    className="text-[12px] font-semibold"
                    style={{
                      color:
                        issue.severity === "warn"
                          ? "#8a3733"
                          : "var(--color-ink)",
                    }}
                  >
                    {issue.message}
                  </p>
                  <p
                    className="mt-0.5 text-[11.5px] leading-relaxed"
                    style={{
                      color:
                        issue.severity === "warn"
                          ? "#8a3733"
                          : "var(--color-ink-mute)",
                    }}
                  >
                    {issue.fix}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelShell>

        <PanelShell index={4} label="Tracking">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-[230px] shrink-0 space-y-2.5">
              <TrackToggle
                label="Track opens"
                checked={draft.trackOpens}
                onChange={(on) => patch({ trackOpens: on })}
              />
              <TrackToggle
                label="Track clicks"
                checked={draft.trackClicks}
                onChange={(on) => patch({ trackClicks: on })}
              />
            </div>
            <p
              className="flex min-w-0 flex-1 items-start gap-2 rounded-md border px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-mute"
              style={{
                backgroundColor: "var(--color-paper)",
                borderColor: "var(--color-hairline)",
              }}
            >
              <Info size={13} strokeWidth={1.5} className="mt-px shrink-0" />
              Apple Mail pre-fetches images for most of our customers, so opens
              read high and cannot be taken literally. Clicks are the honest
              number, read them first.
            </p>
          </div>
        </PanelShell>
      </div>

      <ReachRail
        preview={preview}
        recounting={recounting}
        blockedBy={unknownFields}
        scheduledFor={scheduledFor}
        onScheduledForChange={setScheduledFor}
        pending={pending}
        status={status}
        onSaveDraft={() =>
          startTransition(async () => {
            setStatus(null);
            if (await save()) setStatus({ tone: "ok", text: "Saved." });
          })
        }
        onSendTest={() =>
          startTransition(async () => {
            setStatus(null);
            if (!(await save())) return;
            const result = await sendTestAction(draft.id);
            setStatus(
              result.ok
                ? { tone: "ok", text: `Test sent to ${result.to}.` }
                : { tone: "error", text: result.error },
            );
          })
        }
        onSaveAsTemplate={() => {
          const name = window.prompt(
            "Save this wording as a template. What should it be called?",
            draft.name,
          );
          if (name === null) return;
          startTransition(async () => {
            setStatus(null);
            if (!(await save())) return;
            const result = await saveCampaignAsTemplateAction({
              campaignId: draft.id,
              name,
              category: "Market update",
              description: "",
            });
            setStatus(
              result.ok
                ? {
                    tone: "ok",
                    text: "Saved to Templates. Set its category there.",
                  }
                : { tone: "error", text: result.error },
            );
          });
        }}
        onSend={() => {
          const count = preview?.count ?? 0;
          const when = scheduledFor
            ? `on ${new Date(scheduledFor).toLocaleString("en-AU")}`
            : "now";
          if (
            !window.confirm(
              `Send "${draft.name}" to ${count} ${count === 1 ? "person" : "people"} ${when}?`,
            )
          ) {
            return;
          }
          startTransition(async () => {
            setStatus(null);
            if (!(await save())) return;
            const result = await startCampaignAction({
              id: draft.id,
              scheduledFor: scheduledFor || null,
            });
            if (result.ok) router.refresh();
            else setStatus({ tone: "error", text: result.error });
          });
        }}
      />
    </div>
  );
}

function TrackToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-[12.5px] text-ink-soft"
    >
      {label}
      <span
        className="mf-quiet relative h-[17px] w-[30px] shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? "#161461" : "#d8dbe2" }}
      >
        <span
          className="mf-quiet absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all"
          style={{ left: checked ? 15 : 2 }}
        />
      </span>
    </button>
  );
}

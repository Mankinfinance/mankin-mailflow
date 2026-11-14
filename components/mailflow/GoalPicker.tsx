"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { setAutomationGoalAction } from "@/app/(mailflow)/marketing/automations/actions";
import type { Goal } from "@/lib/automations/types";

/**
 * The sequence's goal: the outcome that makes the rest of it pointless.
 *
 * Someone who books an appointment shouldn't get the "still thinking
 * about it?" nudge two days later. Before each step the engine checks
 * the goal against the contact as they are now, and stops the sequence
 * for them the moment it's met.
 *
 * Editable while live: a goal can only stop someone early, never send
 * them anything extra.
 */

export interface GoalPickerProps {
  automationId: string;
  current: Goal | null;
  stages: Array<{ id: string; label: string }>;
  tags: Array<{ tag: string; count: number }>;
  /** How many people have reached the goal so far. */
  reached: number;
}

type Kind = "none" | Goal["kind"];

export function GoalPicker({ automationId, current, stages, tags, reached }: GoalPickerProps) {
  const router = useRouter();
  const [kind, setKind] = React.useState<Kind>(current?.kind ?? "none");
  const [stageIds, setStageIds] = React.useState<string[]>(
    current?.kind === "stage" ? current.stageIds : [],
  );
  const [tag, setTag] = React.useState(current?.kind === "tag" ? current.tag : "");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function goalFromForm(): Goal | null | "incomplete" {
    if (kind === "none") return null;
    if (kind === "clicked") return { kind: "clicked" };
    if (kind === "stage") return stageIds.length ? { kind: "stage", stageIds } : "incomplete";
    const t = tag.trim();
    return t ? { kind: "tag", tag: t } : "incomplete";
  }

  function save() {
    setError(null);
    setSaved(false);
    const goal = goalFromForm();
    if (goal === "incomplete") {
      setError(kind === "stage" ? "Pick at least one stage." : "Type the tag.");
      return;
    }
    startTransition(async () => {
      const result = await setAutomationGoalAction(automationId, goal);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error ?? "That didn't work.");
      }
    });
  }

  function toggleStage(id: string) {
    setSaved(false);
    setStageIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  return (
    <div className="mb-3.5 rounded-[10px] border border-hairline bg-surface px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <Flag size={13} strokeWidth={1.7} style={{ color: "#2f6f4a" }} />
        <span
          className="text-[10px] font-bold uppercase"
          style={{ letterSpacing: "0.12em", color: "#2f6f4a" }}
        >
          Goal
        </span>
        {reached > 0 && (
          <span className="ml-auto text-[11px] text-ink-mute">
            {reached} {reached === 1 ? "person has" : "people have"} reached it
          </span>
        )}
      </div>

      <p className="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-ink-mute">
        When someone reaches the goal, their sequence stops, so nobody gets a nudge
        after they&rsquo;ve already done the thing it was nudging them towards.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="Goal"
          value={kind}
          disabled={pending}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setSaved(false);
            setError(null);
          }}
          className="h-[32px] min-w-[240px] rounded-md border border-hairline bg-surface px-2 text-[12.5px] text-ink disabled:opacity-60"
        >
          <option value="none">No goal: everyone gets every step</option>
          <option value="stage">Their deal reaches a stage</option>
          <option value="tag">They&rsquo;re given a tag</option>
          <option value="clicked">They click a link in any of its emails</option>
        </select>

        {kind === "tag" && (
          <>
            <input
              aria-label="Tag"
              list={`goal-tags-${automationId}`}
              value={tag}
              maxLength={60}
              placeholder="e.g. booked"
              onChange={(e) => {
                setTag(e.target.value);
                setSaved(false);
              }}
              className="h-[32px] w-[180px] rounded-md border border-hairline bg-surface px-2 text-[12.5px] text-ink"
            />
            <datalist id={`goal-tags-${automationId}`}>
              {tags.map((t) => (
                <option key={t.tag} value={t.tag} />
              ))}
            </datalist>
          </>
        )}

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-[32px] rounded-md bg-navy px-3 text-[12px] font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save goal"}
        </button>

        {saved && !pending && (
          <span className="text-[11.5px] font-semibold" style={{ color: "#2f6f4a" }}>
            Saved.
          </span>
        )}
      </div>

      {kind === "stage" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stages.map((s) => {
            const on = stageIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStage(s.id)}
                className="rounded-full border px-2.5 py-1 text-[11.5px]"
                style={
                  on
                    ? { backgroundColor: "#e7f2ea", borderColor: "#9cc7a9", color: "#1f5134" }
                    : { borderColor: "var(--color-hairline, #e3e0d8)", color: "#5f636e" }
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}
    </div>
  );
}

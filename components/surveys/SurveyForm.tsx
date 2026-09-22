"use client";

import * as React from "react";
import { Check, Star } from "lucide-react";
import { submitSurveyAction } from "@/app/s/[token]/actions";
import {
  NPS_MAX,
  NPS_MIN,
  RATING_MAX,
  type SurveyConfig,
  type SurveyQuestion,
} from "@/lib/surveys/types";

/**
 * The survey a client fills in.
 *
 * Built for a phone held in one hand, because that is where an email
 * link gets opened. The NPS row is eleven tap targets, so it scrolls
 * horizontally rather than wrapping into an ambiguous grid — a 0-10
 * scale that wraps after 7 stops reading as a scale.
 *
 * One page, no progress bar, no "question 1 of 2". Both templates are
 * short enough that a progress indicator would be longer than the
 * progress it indicates.
 */

export function SurveyForm({
  token,
  config,
  alreadyAnswered,
}: {
  token: string;
  config: SurveyConfig;
  /** Their previous answers, when they have already responded. */
  alreadyAnswered: Record<string, number | string> | null;
}) {
  const [answers, setAnswers] = React.useState<Record<string, number | string>>(
    alreadyAnswered ?? {},
  );
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  /* Someone arriving back at a survey they already answered sees their
     answers and can change them, rather than being told they have had
     their turn. A second submission replaces the first. */
  const revisiting = alreadyAnswered !== null && !done;

  function set(id: string, value: number | string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitSurveyAction(token, answers);
      if (result.ok) setDone(true);
      else setError(result.error ?? "That didn't send.");
    });
  }

  if (done) {
    return (
      <div className="text-center">
        <div
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: "#eef5f0" }}
        >
          <Check size={20} strokeWidth={2} style={{ color: "#2f6f4a" }} />
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          {config.thanks}
        </p>
      </div>
    );
  }

  return (
    <div>
      {revisiting && (
        <p
          className="mb-5 rounded-md border px-3 py-2 text-[12.5px] leading-relaxed"
          style={{ backgroundColor: "#f6f8ff", borderColor: "#cfd7f5", color: "#3b4796" }}
        >
          You have answered this already — your answers are below. Change
          anything you like and send again.
        </p>
      )}

      <div className="flex flex-col gap-7">
        {config.questions.map((q) => (
          <Question
            key={q.id}
            question={q}
            value={answers[q.id]}
            onChange={(v) => set(q.id, v)}
          />
        ))}
      </div>

      {error && (
        <p className="mt-5 text-[13px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-7 h-11 w-full rounded-md text-[14px] font-bold transition-opacity disabled:opacity-60"
        style={{ backgroundColor: "#161461", color: "#ffffff" }}
      >
        {pending ? "Sending…" : config.submitLabel}
      </button>
    </div>
  );
}

function Question({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: number | string | undefined;
  onChange: (value: number | string) => void;
}) {
  return (
    <div>
      <label className="block text-[15px] font-semibold leading-snug text-ink">
        {question.prompt}
        {!question.required && (
          <span className="ml-1.5 text-[12px] font-normal text-ink-faint">
            optional
          </span>
        )}
      </label>
      {question.help && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-mute">
          {question.help}
        </p>
      )}

      <div className="mt-3">
        {question.kind === "nps" && (
          <NpsScale value={typeof value === "number" ? value : null} onChange={onChange} />
        )}
        {question.kind === "rating" && (
          <Rating value={typeof value === "number" ? value : null} onChange={onChange} />
        )}
        {question.kind === "choice" && (
          <Choices
            options={question.options ?? []}
            value={typeof value === "string" ? value : null}
            onChange={onChange}
          />
        )}
        {question.kind === "text" && (
          <textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink"
            placeholder="Type here…"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The 0-10 row.
 *
 * Scrolls sideways on a narrow screen instead of wrapping: a scale
 * that breaks into two rows of unequal length reads as two questions.
 * The ends are labelled because "0" and "10" alone do not say which
 * direction is good.
 */
function NpsScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const scores = Array.from(
    { length: NPS_MAX - NPS_MIN + 1 },
    (_, i) => NPS_MIN + i,
  );
  return (
    <div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {scores.map((n) => {
          const picked = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-label={`${n} out of 10`}
              aria-pressed={picked}
              className="h-11 min-w-[38px] shrink-0 rounded-md border text-[14px] font-semibold tabular-nums transition-colors"
              style={{
                backgroundColor: picked ? "#161461" : "var(--color-surface)",
                color: picked ? "#ffffff" : "var(--color-ink-soft)",
                borderColor: picked ? "#161461" : "var(--color-hairline)",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
        <span>Not at all likely</span>
        <span>Extremely likely</span>
      </div>
    </div>
  );
}

function Rating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => {
        const lit = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} out of ${RATING_MAX}`}
            aria-pressed={value === n}
            className="mf-quiet flex h-11 w-11 items-center justify-center rounded-md border transition-colors"
            style={{
              backgroundColor: lit ? "#fbf6ea" : "var(--color-surface)",
              borderColor: lit ? "#e3ad4b" : "var(--color-hairline)",
            }}
          >
            <Star
              size={19}
              strokeWidth={1.6}
              style={{
                color: lit ? "#b8861f" : "var(--color-ink-faint)",
                fill: lit ? "#e3ad4b" : "none",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function Choices({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const picked = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={picked}
            className="flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-[14px] transition-colors"
            style={{
              backgroundColor: picked ? "#f6f8ff" : "var(--color-surface)",
              borderColor: picked ? "#8b96d8" : "var(--color-hairline)",
              color: picked ? "#2b3576" : "var(--color-ink-soft)",
            }}
          >
            <span
              className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border"
              style={{
                borderColor: picked ? "#4151a8" : "var(--color-hairline-soft)",
                backgroundColor: picked ? "#4151a8" : "transparent",
              }}
            >
              {picked && <Check size={11} strokeWidth={3} color="#ffffff" />}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

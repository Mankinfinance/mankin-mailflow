import { CircleAlert, Star } from "lucide-react";
import {
  MIN_RESPONSES_FOR_NPS,
  describeNps,
  type QuestionSummary,
} from "@/lib/surveys/scoring";
import { NPS_BUCKET_LABELS } from "@/lib/surveys/types";
import { Card, Eyebrow } from "@/components/mailflow/MailflowPage";

/**
 * What the answers add up to.
 *
 * The NPS score is a hero number rather than a chart, because it is one
 * number — and it is printed with the range it actually occupies, not
 * alone. A score of 42 on 31 responses sits somewhere between 7 and 77,
 * and showing "42" by itself invites a decision the data cannot carry.
 *
 * The three buckets are a status encoding, not a categorical one:
 * promoter and detractor are good and bad, not two colours of the same
 * kind. So they use the status palette and every segment carries its
 * own label, because colour alone would leave a colourblind reader
 * guessing which end was which.
 *
 * Ratings and choices are tables with a bar in them, for the reason
 * they always are here: the count is half the information, and a bare
 * chart shows two bars the same height whether they rest on 300
 * responses or nine.
 */

const BUCKET_TONE = {
  promoter: { fill: "#2f6f4a", soft: "#eef5f0" },
  passive: { fill: "#8a6a22", soft: "#f3eee4" },
  detractor: { fill: "#a3423e", soft: "#fbf0ef" },
} as const;

export function SurveyResults({
  summaries,
  sent,
}: {
  summaries: QuestionSummary[];
  /** Invitations sent, for the response rate. */
  sent: number;
}) {
  if (summaries.length === 0) {
    return (
      <Card>
        <p className="py-3 text-center text-[12.5px] text-ink-mute">
          This survey has no questions yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3.5">
      {summaries.map((s) => (
        <div key={s.questionId}>
          {s.kind === "nps" && <NpsCard summary={s} sent={sent} />}
          {s.kind === "rating" && <RatingCard summary={s} />}
          {s.kind === "choice" && <ChoiceCard summary={s} />}
          {s.kind === "text" && <TextCard summary={s} />}
        </div>
      ))}
    </div>
  );
}

function NpsCard({
  summary,
  sent,
}: {
  summary: Extract<QuestionSummary, { kind: "nps" }>;
  sent: number;
}) {
  const { nps } = summary;
  const total = nps.responses;

  return (
    <Card>
      <Eyebrow className="mb-1">Would they recommend us</Eyebrow>
      <p className="mb-3 max-w-[560px] text-[11.5px] leading-relaxed text-ink-mute">
        {summary.prompt}
      </p>

      {nps.score === null ? (
        <div
          className="rounded-md border px-3.5 py-3"
          style={{ backgroundColor: "var(--color-paper-warm)", borderColor: "var(--color-hairline)" }}
        >
          <div className="text-[22px] font-semibold tabular-nums text-ink">
            {total} {total === 1 ? "response" : "responses"}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
            No score yet — it needs {MIN_RESPONSES_FOR_NPS}. Below that the
            figure moves further on one extra answer than it could possibly
            mean.
          </p>
        </div>
      ) : (
        <div className="flex items-end gap-4">
          <div>
            <div
              className="text-[46px] leading-none tabular-nums text-brand-deep"
              style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
            >
              {Math.round(nps.score)}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              Net promoter
            </div>
          </div>
          <p className="pb-1 max-w-[320px] text-[11.5px] leading-relaxed text-ink-mute">
            {describeNps(nps)}
          </p>
        </div>
      )}

      {total > 0 && (
        <>
          {/* Stacked into one bar, with a 2px surface gap between
              segments so adjacent fills stay distinguishable. */}
          <div className="mt-4 flex gap-[2px]">
            {(["promoter", "passive", "detractor"] as const).map((bucket) => {
              const count =
                bucket === "promoter"
                  ? nps.promoters
                  : bucket === "passive"
                    ? nps.passives
                    : nps.detractors;
              if (count === 0) return null;
              return (
                <div
                  key={bucket}
                  className="h-[8px] rounded-[2px]"
                  style={{
                    width: `${(count / total) * 100}%`,
                    backgroundColor: BUCKET_TONE[bucket].fill,
                  }}
                />
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {(["promoter", "passive", "detractor"] as const).map((bucket) => {
              const count =
                bucket === "promoter"
                  ? nps.promoters
                  : bucket === "passive"
                    ? nps.passives
                    : nps.detractors;
              return (
                <span key={bucket} className="flex items-baseline gap-1.5">
                  <span
                    className="mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full"
                    style={{ backgroundColor: BUCKET_TONE[bucket].fill }}
                  />
                  <span className="text-[11.5px] text-ink-mute">
                    {NPS_BUCKET_LABELS[bucket]}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-ink">
                    {count}
                  </span>
                </span>
              );
            })}
          </div>

          {sent > 0 && (
            <p className="mt-3 border-t pt-2 text-[10.5px] text-ink-faint" style={{ borderColor: "var(--color-hairline-softer)" }}>
              {total} of {sent} answered — {((total / sent) * 100).toFixed(0)}%.
            </p>
          )}

          {nps.detractors > 0 && (
            <div
              className="mt-3 flex gap-2 rounded-md border px-3 py-2.5"
              style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
            >
              <CircleAlert
                size={13}
                strokeWidth={1.8}
                className="mt-px shrink-0"
                style={{ color: "#8a4b48" }}
              />
              <p className="text-[11.5px] leading-relaxed text-ink-soft">
                {nps.detractors === 1 ? "One client" : `${nps.detractors} clients`}{" "}
                said they would not recommend us. Their names are on the
                responses below — that is the whole reason for asking, and a
                phone call does more than a number does.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function RatingCard({
  summary,
}: {
  summary: Extract<QuestionSummary, { kind: "rating" }>;
}) {
  const max = Math.max(1, ...summary.distribution);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Eyebrow>{summary.prompt}</Eyebrow>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {summary.mean !== null
            ? `${summary.mean.toFixed(1)} average`
            : "too few to average"}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = summary.distribution[stars - 1];
          return (
            <div key={stars} className="flex items-center gap-2.5">
              <span className="flex w-[74px] shrink-0 gap-[2px]">
                {Array.from({ length: stars }, (_, i) => (
                  <Star
                    key={i}
                    size={11}
                    strokeWidth={1.6}
                    style={{ color: "#b8861f", fill: "#e3ad4b" }}
                  />
                ))}
              </span>
              <span
                className="h-[6px] flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--color-paper-warm)" }}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${count === 0 ? 0 : Math.max(2, (count / max) * 100)}%`,
                    backgroundColor: "#161461",
                  }}
                />
              </span>
              <span className="w-[26px] shrink-0 text-right text-[12px] tabular-nums text-ink-soft">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[10.5px] text-ink-faint">
        {summary.responses} {summary.responses === 1 ? "answer" : "answers"}.
      </p>
    </Card>
  );
}

function ChoiceCard({
  summary,
}: {
  summary: Extract<QuestionSummary, { kind: "choice" }>;
}) {
  const max = Math.max(1, ...summary.counts.map((c) => c.count));
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Eyebrow>{summary.prompt}</Eyebrow>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {summary.responses} {summary.responses === 1 ? "answer" : "answers"}
        </span>
      </div>
      {summary.responses === 0 ? (
        <p className="py-2 text-[12px] text-ink-mute">Nobody has answered this yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {summary.counts
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((c) => (
              <div key={c.option}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12.5px] text-ink">{c.option}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                    <strong className="font-semibold text-ink">{c.count}</strong>
                    <span className="text-ink-mute"> · {c.share.toFixed(0)}%</span>
                  </span>
                </div>
                <div
                  className="mt-1 h-[6px] w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--color-paper-warm)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${c.count === 0 ? 0 : Math.max(2, (c.count / max) * 100)}%`,
                      backgroundColor: "#161461",
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Free text is listed, never summarised.
 *
 * The value of "the valuation took three weeks and nobody told us" is
 * entirely in the sentence. Counting themes across nineteen answers
 * would throw away the only thing worth having.
 */
function TextCard({
  summary,
}: {
  summary: Extract<QuestionSummary, { kind: "text" }>;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Eyebrow>{summary.prompt}</Eyebrow>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {summary.responses} {summary.responses === 1 ? "answer" : "answers"}
        </span>
      </div>
      {summary.answers.length === 0 ? (
        <p className="py-2 text-[12px] text-ink-mute">Nothing written yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {summary.answers.map((a) => (
            <li
              key={`${a.email}-${a.at.toISOString()}`}
              className="border-l-2 pl-3"
              style={{ borderColor: "#cfd7f5" }}
            >
              <p className="text-[13px] leading-relaxed text-ink">{a.text}</p>
              <p className="mt-1 text-[10.5px] text-ink-faint">
                {a.name || a.email} ·{" "}
                {a.at.toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

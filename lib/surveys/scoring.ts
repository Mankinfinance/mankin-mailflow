import { npsBucket, type NpsBucket, type SurveyAnswers, type SurveyQuestion } from "./types";

/**
 * Counting survey answers, and being honest about how much a small
 * number of them can tell you.
 *
 * NPS is the most over-read number in business software. It is a
 * difference of two percentages, so its error bars are roughly twice
 * those of a single proportion: on twenty responses the true score
 * could sit thirty points either side of the one displayed. Platforms
 * print it to one decimal place anyway, next to an arrow showing it
 * "up 4 points since last quarter", and people make decisions on that
 * movement.
 *
 * A brokerage sending to a few hundred clients will collect responses
 * in the dozens. So this returns the score with the count it came from,
 * refuses to give a score at all below a floor, and says plainly when a
 * change between two periods is smaller than the noise.
 *
 * Pure module — answers in, summary out.
 */

/**
 * Below this, no score. Thirty is not a statistically comfortable
 * number either; it is the point where the figure stops being actively
 * misleading. The response count sits beside the score at every size
 * so the reader can apply their own discount.
 */
export const MIN_RESPONSES_FOR_NPS = 30;

/** Below this, not even the bucket breakdown is worth drawing. */
export const MIN_RESPONSES_FOR_BUCKETS = 5;

export interface NpsSummary {
  /** Responses that answered the NPS question at all. */
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** -100 to 100. Null below MIN_RESPONSES_FOR_NPS. */
  score: number | null;
  /**
   * Plus or minus, in points, at roughly 95% confidence. Null when
   * there is no score. Printed next to it, because a score of 42 on 31
   * responses is "somewhere between 7 and 77" and that is the fact.
   */
  margin: number | null;
}

/** One question's answers, counted the way that question deserves. */
export type QuestionSummary =
  | { kind: "nps"; questionId: string; prompt: string; nps: NpsSummary }
  | {
      kind: "rating";
      questionId: string;
      prompt: string;
      responses: number;
      /** Null below the bucket floor — a mean of three ratings is noise. */
      mean: number | null;
      /** Count per star, 1..RATING_MAX. */
      distribution: number[];
    }
  | {
      kind: "choice";
      questionId: string;
      prompt: string;
      responses: number;
      counts: Array<{ option: string; count: number; share: number }>;
    }
  | {
      kind: "text";
      questionId: string;
      prompt: string;
      responses: number;
      /** Every answer, newest first. Text is read, not aggregated. */
      answers: Array<{ email: string; name: string; text: string; at: Date }>;
    };

export interface ResponseRow {
  email: string;
  name: string;
  answers: SurveyAnswers;
  submittedAt: Date;
}

/** Score, buckets and margin from raw 0-10 answers. */
export function summariseNps(scores: number[]): NpsSummary {
  const valid = scores.filter(
    (s) => Number.isFinite(s) && s >= 0 && s <= 10,
  );
  const buckets: Record<NpsBucket, number> = {
    promoter: 0,
    passive: 0,
    detractor: 0,
  };
  for (const s of valid) buckets[npsBucket(Math.round(s))]++;

  const n = valid.length;
  const readable = n >= MIN_RESPONSES_FOR_NPS;
  const score = readable
    ? ((buckets.promoter - buckets.detractor) / n) * 100
    : null;

  return {
    responses: n,
    promoters: buckets.promoter,
    passives: buckets.passive,
    detractors: buckets.detractor,
    score,
    margin: readable ? npsMargin(buckets, n) : null,
  };
}

/**
 * The standard error of an NPS, times 1.96.
 *
 * NPS is promoters minus detractors over n, so its variance is
 * p + d - (p - d)^2 over n, where p and d are the two proportions.
 * Passives contribute nothing to the score but do count in n, which is
 * why a wall of 7s and 8s drags the margin down without moving the
 * number.
 */
function npsMargin(
  buckets: Record<NpsBucket, number>,
  n: number,
): number {
  const p = buckets.promoter / n;
  const d = buckets.detractor / n;
  const variance = p + d - (p - d) ** 2;
  return 1.96 * Math.sqrt(Math.max(0, variance) / n) * 100;
}

/**
 * Whether a change between two periods is worth saying out loud.
 *
 * Two independent scores, so the margins add in quadrature. Returns
 * null when either period is too thin to have a score at all — which
 * is the common case, and is a better answer than an arrow.
 */
export function npsMoved(
  before: NpsSummary,
  after: NpsSummary,
): { changed: boolean; delta: number } | null {
  if (
    before.score === null ||
    after.score === null ||
    before.margin === null ||
    after.margin === null
  ) {
    return null;
  }
  const delta = after.score - before.score;
  const combined = Math.sqrt(before.margin ** 2 + after.margin ** 2);
  return { changed: Math.abs(delta) > combined, delta };
}

/** Summarise every question in a survey against its responses. */
export function summariseSurvey(
  questions: SurveyQuestion[],
  responses: ResponseRow[],
): QuestionSummary[] {
  return questions.map((q): QuestionSummary => {
    const answered = responses.filter(
      (r) => r.answers[q.id] !== undefined && r.answers[q.id] !== "",
    );

    switch (q.kind) {
      case "nps":
        return {
          kind: "nps",
          questionId: q.id,
          prompt: q.prompt,
          nps: summariseNps(answered.map((r) => Number(r.answers[q.id]))),
        };

      case "rating": {
        const values = answered
          .map((r) => Math.round(Number(r.answers[q.id])))
          .filter((v) => v >= 1 && v <= 5);
        const distribution = [0, 0, 0, 0, 0];
        for (const v of values) distribution[v - 1]++;
        return {
          kind: "rating",
          questionId: q.id,
          prompt: q.prompt,
          responses: values.length,
          mean:
            values.length >= MIN_RESPONSES_FOR_BUCKETS
              ? values.reduce((a, b) => a + b, 0) / values.length
              : null,
          distribution,
        };
      }

      case "choice": {
        const options = q.options ?? [];
        const tally = new Map<string, number>(options.map((o) => [o, 0]));
        for (const r of answered) {
          const picked = String(r.answers[q.id]);
          /* An option removed from the survey after someone answered it
             still has their answer. Counting it keeps the shares honest
             rather than quietly dropping a response. */
          tally.set(picked, (tally.get(picked) ?? 0) + 1);
        }
        const total = answered.length;
        return {
          kind: "choice",
          questionId: q.id,
          prompt: q.prompt,
          responses: total,
          counts: [...tally.entries()].map(([option, count]) => ({
            option,
            count,
            share: total > 0 ? (count / total) * 100 : 0,
          })),
        };
      }

      case "text":
        return {
          kind: "text",
          questionId: q.id,
          prompt: q.prompt,
          responses: answered.length,
          answers: answered
            .map((r) => ({
              email: r.email,
              name: r.name,
              text: String(r.answers[q.id]),
              at: r.submittedAt,
            }))
            .sort((a, b) => b.at.getTime() - a.at.getTime()),
        };
    }
  });
}

/** The response rate, where we know how many were asked. */
export function responseRate(
  responses: number,
  sent: number,
): number | null {
  return sent > 0 ? (responses / sent) * 100 : null;
}

/** One line for the header, stating the score and its uncertainty. */
export function describeNps(nps: NpsSummary): string {
  if (nps.responses === 0) return "No responses yet.";
  if (nps.score === null) {
    return `${nps.responses} ${nps.responses === 1 ? "response" : "responses"} — too few for a score. It needs ${MIN_RESPONSES_FOR_NPS}.`;
  }
  const low = Math.round(nps.score - (nps.margin ?? 0));
  const high = Math.round(nps.score + (nps.margin ?? 0));
  return `${Math.round(nps.score)} on ${nps.responses} responses, which puts it somewhere between ${low} and ${high}.`;
}

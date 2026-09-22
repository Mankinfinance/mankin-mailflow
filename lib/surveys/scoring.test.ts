import { describe, it, expect } from "vitest";
import {
  MIN_RESPONSES_FOR_BUCKETS,
  MIN_RESPONSES_FOR_NPS,
  describeNps,
  npsMoved,
  responseRate,
  summariseNps,
  summariseSurvey,
  type ResponseRow,
} from "./scoring";
import type { SurveyQuestion } from "./types";

/** n scores of one value, for building a distribution quickly. */
function repeat(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value);
}

function response(over: Partial<ResponseRow> = {}): ResponseRow {
  return {
    email: "a@b.com",
    name: "Sarah Chen",
    answers: {},
    submittedAt: new Date("2026-06-01T02:00:00Z"),
    ...over,
  };
}

describe("summariseNps", () => {
  it("buckets on the standard boundaries", () => {
    // Not ours to reinvent — the number only means something because
    // everyone cuts it at 6 and 8.
    const s = summariseNps([0, 6, 7, 8, 9, 10]);
    expect(s.detractors).toBe(2);
    expect(s.passives).toBe(2);
    expect(s.promoters).toBe(2);
  });

  it("scores promoters minus detractors as a percentage", () => {
    const s = summariseNps([...repeat(10, 30), ...repeat(0, 10)]);
    // 30 promoters, 10 detractors, n=40 → (30-10)/40 = 50
    expect(s.score).toBeCloseTo(50);
  });

  it("counts passives in the denominator but not the score", () => {
    // A wall of 7s and 8s leaves the score untouched and the margin
    // tighter, which is the whole subtlety of the measure.
    const s = summariseNps([...repeat(10, 10), ...repeat(0, 10), ...repeat(8, 20)]);
    expect(s.score).toBeCloseTo(0);
    expect(s.passives).toBe(20);
    expect(s.responses).toBe(40);
  });

  it("withholds a score below the floor", () => {
    const s = summariseNps(repeat(10, MIN_RESPONSES_FOR_NPS - 1));
    expect(s.score).toBeNull();
    expect(s.margin).toBeNull();
    expect(s.promoters).toBe(MIN_RESPONSES_FOR_NPS - 1);
  });

  it("gives a score at exactly the floor", () => {
    const s = summariseNps(repeat(10, MIN_RESPONSES_FOR_NPS));
    expect(s.score).toBeCloseTo(100);
  });

  it("ignores answers outside 0-10", () => {
    const s = summariseNps([10, 11, -1, NaN, 5]);
    expect(s.responses).toBe(2);
  });

  it("rounds a fractional answer before bucketing", () => {
    expect(summariseNps([8.6]).promoters).toBe(1);
    expect(summariseNps([8.4]).passives).toBe(1);
  });
});

describe("the margin of error", () => {
  it("is wide on a small sample and narrow on a large one", () => {
    const small = summariseNps([...repeat(10, 20), ...repeat(0, 10)]);
    const large = summariseNps([...repeat(10, 200), ...repeat(0, 100)]);
    expect(small.score).toBeCloseTo(large.score!);
    expect(small.margin!).toBeGreaterThan(large.margin! * 2);
  });

  it("is the reason a mid-range score on thirty responses says little", () => {
    // 42 on 31 responses spans roughly 7 to 77. Printing 42 alone
    // invites a decision the data cannot support.
    const s = summariseNps([...repeat(10, 18), ...repeat(0, 5), ...repeat(8, 8)]);
    expect(s.margin!).toBeGreaterThan(20);
  });

  it("is zero-width only when everyone agrees", () => {
    const s = summariseNps(repeat(10, 50));
    expect(s.score).toBeCloseTo(100);
    expect(s.margin).toBeCloseTo(0);
  });

  it("never returns NaN when the variance rounds below zero", () => {
    const s = summariseNps(repeat(0, 40));
    expect(s.score).toBeCloseTo(-100);
    expect(Number.isFinite(s.margin!)).toBe(true);
  });
});

describe("npsMoved", () => {
  it("says nothing when either period is too thin to score", () => {
    const thin = summariseNps(repeat(10, 5));
    const solid = summariseNps(repeat(10, 40));
    expect(npsMoved(thin, solid)).toBeNull();
    expect(npsMoved(solid, thin)).toBeNull();
  });

  it("calls a small movement no movement", () => {
    // The thing every dashboard gets wrong: an arrow on a change that
    // is smaller than the noise in either figure.
    const before = summariseNps([...repeat(10, 20), ...repeat(0, 10), ...repeat(8, 10)]);
    const after = summariseNps([...repeat(10, 21), ...repeat(0, 10), ...repeat(8, 9)]);
    const moved = npsMoved(before, after)!;
    expect(moved.changed).toBe(false);
  });

  it("confirms a movement that clears both margins", () => {
    const before = summariseNps(repeat(0, 60));
    const after = summariseNps(repeat(10, 60));
    const moved = npsMoved(before, after)!;
    expect(moved.changed).toBe(true);
    expect(moved.delta).toBeCloseTo(200);
  });
});

describe("summariseSurvey", () => {
  const questions: SurveyQuestion[] = [
    { id: "nps", kind: "nps", prompt: "Recommend us?", required: true },
    { id: "clarity", kind: "rating", prompt: "Clear?", required: false },
    {
      id: "slowest",
      kind: "choice",
      prompt: "Slowest part?",
      options: ["Docs", "Lender"],
      required: false,
    },
    { id: "why", kind: "text", prompt: "Why?", required: false },
  ];

  it("counts only responses that answered each question", () => {
    const rows = [
      response({ answers: { nps: 10 } }),
      response({ answers: { nps: 9, why: "Quick" } }),
      response({ answers: {} }),
    ];
    const out = summariseSurvey(questions, rows);
    const nps = out[0];
    expect(nps.kind === "nps" && nps.nps.responses).toBe(2);
    const text = out[3];
    expect(text.kind === "text" && text.responses).toBe(1);
  });

  it("treats an empty string as no answer", () => {
    // A skipped free-text box posts "" rather than nothing, and would
    // otherwise count as a response with no content.
    const out = summariseSurvey(questions, [response({ answers: { why: "" } })]);
    const text = out[3];
    expect(text.kind === "text" && text.responses).toBe(0);
  });

  it("withholds a rating mean below the floor", () => {
    const rows = Array.from({ length: MIN_RESPONSES_FOR_BUCKETS - 1 }, () =>
      response({ answers: { clarity: 5 } }),
    );
    const rating = summariseSurvey(questions, rows)[1];
    expect(rating.kind === "rating" && rating.mean).toBeNull();
    expect(rating.kind === "rating" && rating.responses).toBe(
      MIN_RESPONSES_FOR_BUCKETS - 1,
    );
  });

  it("distributes ratings across the five stars", () => {
    const rows = [
      response({ answers: { clarity: 5 } }),
      response({ answers: { clarity: 5 } }),
      response({ answers: { clarity: 1 } }),
    ];
    const rating = summariseSurvey(questions, rows)[1];
    expect(rating.kind === "rating" && rating.distribution).toEqual([1, 0, 0, 0, 2]);
  });

  it("shares choice answers against those who answered, not everyone", () => {
    const rows = [
      response({ answers: { slowest: "Docs" } }),
      response({ answers: { slowest: "Lender" } }),
      response({ answers: { nps: 9 } }),
    ];
    const choice = summariseSurvey(questions, rows)[2];
    expect(choice.kind === "choice" && choice.responses).toBe(2);
    const docs = choice.kind === "choice" && choice.counts.find((c) => c.option === "Docs");
    expect(docs && docs.share).toBeCloseTo(50);
  });

  it("keeps an answer whose option was later removed from the survey", () => {
    // Dropping it would make the shares add to less than the responses.
    const rows = [response({ answers: { slowest: "Something retired" } })];
    const choice = summariseSurvey(questions, rows)[2];
    expect(choice.kind === "choice" && choice.counts.map((c) => c.option)).toContain(
      "Something retired",
    );
  });

  it("puts the newest free-text answer first", () => {
    const rows = [
      response({ answers: { why: "older" }, submittedAt: new Date("2026-05-01") }),
      response({ answers: { why: "newer" }, submittedAt: new Date("2026-07-01") }),
    ];
    const text = summariseSurvey(questions, rows)[3];
    expect(text.kind === "text" && text.answers[0].text).toBe("newer");
  });

  it("copes with a survey nobody has answered", () => {
    const out = summariseSurvey(questions, []);
    expect(out).toHaveLength(4);
    expect(out[0].kind === "nps" && out[0].nps.score).toBeNull();
  });
});

describe("responseRate", () => {
  it("is null when nothing was sent, rather than zero", () => {
    expect(responseRate(0, 0)).toBeNull();
    expect(responseRate(12, 100)).toBeCloseTo(12);
  });
});

describe("describeNps", () => {
  it("states the range rather than just the number", () => {
    const line = describeNps(summariseNps([...repeat(10, 30), ...repeat(0, 10)]));
    expect(line).toMatch(/somewhere between/);
    expect(line).toMatch(/40 responses/);
  });

  it("says how many more are needed when it cannot score", () => {
    expect(describeNps(summariseNps(repeat(10, 4)))).toMatch(/too few/);
  });

  it("handles no responses at all", () => {
    expect(describeNps(summariseNps([]))).toBe("No responses yet.");
  });
});

import { describe, it, expect } from "vitest";
import {
  MIN_AUDIENCE_FOR_TEST,
  assignVariants,
  decideWinner,
  subjectFor,
  testGroupSize,
} from "./ab-test";

describe("testGroupSize", () => {
  it("takes the requested share of the audience", () => {
    expect(testGroupSize(200, 30)).toBe(60);
  });

  it("rounds down to an even number so the arms match", () => {
    // 11 would be 6 against 5, and the bigger arm wins ties for reasons
    // that have nothing to do with the subject line.
    expect(testGroupSize(115, 10)).toBe(10);
    expect(testGroupSize(100, 25)).toBe(24);
  });

  it("refuses to test an audience too small to read", () => {
    expect(testGroupSize(MIN_AUDIENCE_FOR_TEST - 1, 30)).toBe(0);
    expect(testGroupSize(10, 50)).toBe(0);
  });

  it("clamps a silly percentage rather than trusting it", () => {
    expect(testGroupSize(200, 90)).toBe(100); // capped at 50%
    expect(testGroupSize(200, 1)).toBe(20); // floored at 10%
  });

  it("always leaves someone in the holdback", () => {
    // A test with nobody left to send the winner to has decided nothing.
    const size = testGroupSize(40, 50);
    expect(size).toBeLessThanOrEqual(38);
  });
});

describe("assignVariants", () => {
  it("alternates rather than splitting the list in half", () => {
    // The audience arrives sorted by source and settlement date, so a
    // contiguous split would put the oldest loans in one arm and the
    // newest in the other, and measure that instead of the subject.
    const variants = assignVariants(100, 20);
    expect(variants.slice(0, 6)).toEqual(["a", "b", "a", "b", "a", "b"]);
  });

  it("gives both arms the same number of recipients", () => {
    const variants = assignVariants(137, 30);
    const a = variants.filter((v) => v === "a").length;
    const b = variants.filter((v) => v === "b").length;
    expect(a).toBe(b);
  });

  it("holds the rest back", () => {
    const variants = assignVariants(100, 20);
    expect(variants.filter((v) => v === null)).toHaveLength(80);
  });

  it("puts everyone in the holdback when the audience is too small", () => {
    const variants = assignVariants(20, 30);
    expect(variants.every((v) => v === null)).toBe(true);
  });
});

describe("decideWinner", () => {
  const started = new Date("2026-08-26T08:00:00Z");
  const base = {
    aSent: 30,
    aOpened: 12,
    bSent: 30,
    bOpened: 6,
    pendingInTest: 0,
    startedAt: started,
    decideAfterHours: 4,
    now: new Date("2026-08-26T13:00:00Z"),
  };

  it("picks the subject with the higher open rate", () => {
    const decision = decideWinner(base);
    expect(decision.winner).toBe("a");
    expect(decision.a.openRate).toBeCloseTo(40);
    expect(decision.b.openRate).toBeCloseTo(20);
    expect(decision.reason).toMatch(/40\.0%/);
  });

  it("picks B when B wins", () => {
    expect(decideWinner({ ...base, aOpened: 3, bOpened: 15 }).winner).toBe("b");
  });

  it("waits until the window closes", () => {
    // Early opens skew towards whoever happens to be at their desk.
    const decision = decideWinner({
      ...base,
      now: new Date("2026-08-26T09:00:00Z"),
    });
    expect(decision.winner).toBeNull();
    expect(decision.reason).toMatch(/Deciding in about 3 hours/);
  });

  it("waits while test emails are still going out", () => {
    // A half-sent arm has an artificially low open rate.
    const decision = decideWinner({ ...base, pendingInTest: 8 });
    expect(decision.winner).toBeNull();
    expect(decision.reason).toMatch(/8 to go/);
  });

  it("does not decide before the campaign has started", () => {
    const decision = decideWinner({ ...base, startedAt: null });
    expect(decision.winner).toBeNull();
  });

  it("breaks a tie towards A, and says that is what it did", () => {
    const decision = decideWinner({ ...base, aOpened: 9, bOpened: 9 });
    expect(decision.winner).toBe("a");
    expect(decision.reason).toMatch(/Tie/);
  });

  it("releases the holdback when an arm never sent at all", () => {
    // Better to send the rest on subject A than hold them hostage to a
    // test that cannot resolve.
    const decision = decideWinner({ ...base, bSent: 0, bOpened: 0 });
    expect(decision.winner).toBe("a");
    expect(decision.reason).toMatch(/never sent/);
    expect(decision.b.openRate).toBeNull();
  });

  it("reports an unsent arm's rate as unknown, not zero", () => {
    // Zero would read as "nobody opened it", which is a different claim.
    const decision = decideWinner({ ...base, aSent: 0, aOpened: 0 });
    expect(decision.a.openRate).toBeNull();
  });
});

describe("subjectFor", () => {
  const campaign = {
    subject: "Your rate review",
    subjectB: "{{first_name}}, is your rate still competitive?",
    abWinner: null as string | null,
  };

  it("gives each arm its own subject", () => {
    expect(subjectFor(campaign, "a")).toBe("Your rate review");
    expect(subjectFor(campaign, "b")).toBe(campaign.subjectB);
  });

  it("gives the holdback the winning subject", () => {
    expect(subjectFor({ ...campaign, abWinner: "b" }, null)).toBe(
      campaign.subjectB,
    );
    expect(subjectFor({ ...campaign, abWinner: "a" }, null)).toBe(
      "Your rate review",
    );
  });

  it("falls back to subject A when nothing was decided", () => {
    expect(subjectFor(campaign, null)).toBe("Your rate review");
  });

  it("never sends an empty subject when B was cleared mid-test", () => {
    // Someone deleting subject B after the test started must not leave a
    // recipient with a blank subject line.
    const cleared = { ...campaign, subjectB: null, abWinner: "b" };
    expect(subjectFor(cleared, "b")).toBe("Your rate review");
    expect(subjectFor(cleared, null)).toBe("Your rate review");
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * What a survey answer tells other systems, through the real action.
 */

const emitted: { event: string; data: Record<string, unknown> }[] = [];

vi.mock("@/lib/webhooks/dispatch", () => ({
  emitWebhook: async (event: string, data: Record<string, unknown>) => {
    emitted.push({ event, data });
  },
}));

const { repos } = await import("@/lib/db/repos");
const { issueSurveyToken, surveyLink, verifySurveyToken } = await import(
  "./token"
);
const { submitSurveyAction } = await import("@/app/s/[token]/actions");

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

beforeEach(() => {
  emitted.length = 0;
});

async function liveSurvey() {
  return repos().survey.create({
    name: "Post-settlement",
    status: "live",
    createdBy: "mm",
    config: {
      questions: [
        { id: "nps", kind: "nps", prompt: "How likely…", required: true },
        { id: "why", kind: "text", prompt: "What's the main reason?" },
      ],
    },
  });
}

async function answer(score: number, opts: { dealId?: string } = {}) {
  const survey = await liveSurvey();
  const token = await issueSurveyToken({
    sid: survey.id,
    em: "sarah@example.com",
    nm: "Sarah Chen",
    ...(opts.dealId ? { did: opts.dealId } : {}),
  });
  return submitSurveyAction(token, { nps: score, why: "Quick and clear" });
}

describe("the deal a survey was sent for", () => {
  it("rides inside the signed link", async () => {
    const link = await surveyLink({
      surveyId: "s-1",
      email: "sarah@example.com",
      name: "Sarah Chen",
      dealId: "D-77",
    });
    const verified = await verifySurveyToken(link.split("/s/")[1]);
    expect(verified.ok && verified.claims.did).toBe("D-77");
  });

  it("is absent, not empty, when there is no deal", async () => {
    const link = await surveyLink({
      surveyId: "s-1",
      email: "sarah@example.com",
      name: "Sarah Chen",
      dealId: null,
    });
    const verified = await verifySurveyToken(link.split("/s/")[1]);
    expect(verified.ok && "did" in verified.claims).toBe(false);
  });

  it("reaches survey.responded, so the note can find the file", async () => {
    // Survey notes shipped announced and never written: the event
    // named an address and nothing else.
    await answer(9, { dealId: "D-77" });
    const responded = emitted.find((e) => e.event === "survey.responded");
    expect(responded?.data).toMatchObject({
      dealId: "D-77",
      nps: 9,
      comment: "Quick and clear",
    });
  });

  it("is null for links sent before it existed", async () => {
    await answer(9);
    const responded = emitted.find((e) => e.event === "survey.responded");
    expect(responded?.data.dealId).toBeNull();
  });
});

describe("survey.detractor", () => {
  it.each([0, 3, 6])("fires for a %i", async (score) => {
    await answer(score);
    expect(emitted.map((e) => e.event)).toEqual([
      "survey.responded",
      "survey.detractor",
    ]);
  });

  it.each([7, 8, 9, 10])("does not fire for a %i", async (score) => {
    // 7 and 8 are passive, not unhappy. Sharing npsBucket with the
    // report is what keeps this boundary in one place.
    await answer(score);
    expect(emitted.map((e) => e.event)).toEqual(["survey.responded"]);
  });

  it("carries the same payload as the response it came from", async () => {
    await answer(2, { dealId: "D-77" });
    const [responded, detractor] = emitted;
    expect(detractor.data).toEqual(responded.data);
  });
});

import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

const { confirmUnsubscribeAction, saveUnsubscribeFeedbackAction, savePreferencesAction } =
  await import("./actions");
const { issueTrackingToken } = await import("@/lib/campaigns/tracking");
const { repos } = await import("@/lib/db/repos");

const token = (em: string, p: "unsubscribe" | "click" = "unsubscribe") =>
  issueTrackingToken({ cid: "00000000-0000-0000-0000-000000000001", em, p });

describe("the optional unsubscribe reason", () => {
  it("is recorded on the register entry after the unsubscribe", async () => {
    const t = await token("leaving@example.com");
    expect((await confirmUnsubscribeAction(t)).ok).toBe(true);
    expect((await saveUnsubscribeFeedbackAction(t, "too-many")).ok).toBe(true);
    const row = (await repos().campaign.listSuppressions()).find((r) => r.email === "leaving@example.com");
    expect(row?.feedback).toBe("too-many");
    expect(row?.feedbackNote).toBeNull();
  });

  it("keeps their own words only for 'something else', capped", async () => {
    const t = await token("other@example.com");
    await confirmUnsubscribeAction(t);
    await saveUnsubscribeFeedbackAction(t, "other", "x".repeat(500));
    const row = (await repos().campaign.listSuppressions()).find((r) => r.email === "other@example.com");
    expect(row?.feedbackNote?.length).toBe(300);
  });

  it("refuses a made-up reason, the wrong kind of link, or someone not unsubscribed", async () => {
    const t = await token("x@example.com");
    await confirmUnsubscribeAction(t);
    expect((await saveUnsubscribeFeedbackAction(t, "drop table")).ok).toBe(false);
    expect((await saveUnsubscribeFeedbackAction(await token("x@example.com", "click"), "too-many")).ok).toBe(false);
    expect((await saveUnsubscribeFeedbackAction(await token("still-here@example.com"), "too-many")).ok).toBe(false);
  });
});

describe("hearing less instead of nothing", () => {
  it("turns off the topics they unticked, without unsubscribing them", async () => {
    const t = await token("picky@example.com");
    expect((await savePreferencesAction(t, ["rate-news", "guides"])).ok).toBe(true);
    expect((await repos().campaign.topicOptOuts("picky@example.com")).sort()).toEqual([
      "events",
      "market",
    ]);
    const suppressed = await repos().campaign.suppressedAmong(["picky@example.com"]);
    expect(suppressed.size).toBe(0);
  });

  it("turns a topic back on when they tick it again", async () => {
    const t = await token("back@example.com");
    await savePreferencesAction(t, []);
    await savePreferencesAction(t, ["rate-news", "market", "guides", "events"]);
    expect(await repos().campaign.topicOptOuts("back@example.com")).toEqual([]);
  });

  it("refuses the wrong kind of link and ignores made-up topics", async () => {
    expect((await savePreferencesAction(await token("x2@example.com", "click"), [])).ok).toBe(false);
    const t = await token("x3@example.com");
    await savePreferencesAction(t, ["rate-news", "market", "guides", "events", "<script>"]);
    expect(await repos().campaign.topicOptOuts("x3@example.com")).toEqual([]);
  });
});

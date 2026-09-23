import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Engagement with automation emails, end to end through the real
 * routes.
 *
 * These exist because the bug they cover was invisible to every other
 * test. The runner tests set `openedAt` directly on the send row, which
 * exercises the engine with engagement data production could never
 * produce: automation links carried `auto:<id>`, the tracking routes
 * looked that up as a campaign recipient, found nothing, and dropped
 * it. So here nothing is written by hand. The email is sent by the
 * runner, its tokens come from that email, and engagement arrives
 * through the same GET and POST handlers a mail client would hit.
 */

const sendMock = vi.fn();
const emitted: { event: string; data: Record<string, unknown> }[] = [];

vi.mock("@/lib/clients/outlook-mime", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/clients/outlook-mime")
  >("@/lib/clients/outlook-mime");
  return { ...actual, sendMimeViaGraph: (...a: unknown[]) => sendMock(...a) };
});

vi.mock("@/lib/webhooks/dispatch", () => ({
  emitWebhook: async (event: string, data: Record<string, unknown>) => {
    emitted.push({ event, data });
  },
}));

/* The click route ends in next/navigation's redirect, which throws to
   unwind the request. Recorded here instead so the test can see where
   the click was sent. */
const redirected: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.push(to);
  },
}));

vi.mock("@/lib/settlements-store", () => ({
  listSettlements: async () => [
    {
      id: "L-1",
      brokerName: "Michael Mankin",
      brokerId: "mm",
      clientName: "Sarah Chen",
      email: "sarah@example.com",
      lender: "ANZ",
      lenderCode: "ANZ",
      loanId: "L-1",
      settlementDate: "2025-08-25",
      settlementAmount: 640000,
      currentBalance: 610000,
      upfrontCommission: 4000,
      monthlyTrail: 90,
      loanStatus: "active",
      dischargeDate: null,
      source: { onUpfront: true, onTrail: true, onClawback: false },
    },
  ],
}));

vi.mock("@/lib/clients/salestrekker", () => ({
  getSalestrekkerClient: () => ({ listDeals: async () => [] }),
}));

const { tickAutomations } = await import("./runner");
const { repos } = await import("@/lib/db/repos");
const { AUTOMATION_TEMPLATES } = await import("./types");
const { issueTrackingToken, verifyTrackingToken } = await import(
  "@/lib/campaigns/tracking"
);
const { findTrackedMessage, parseTrackingId } = await import(
  "@/lib/campaigns/tracked-message"
);
const openRoute = await import("@/app/e/o/[token]/route");
const clickRoute = await import("@/app/e/c/[token]/route");
const oneClickRoute = await import("@/app/api/e/u/[token]/route");

const NOW = new Date("2026-08-25T09:00:00");
const DAY = 86_400_000;

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, mode: "mock" });
  emitted.length = 0;
  redirected.length = 0;
  for (const a of await repos().automation.list()) {
    await repos().automation.remove(a.id);
  }
  for (const s of await repos().campaign.listSuppressions()) {
    await repos().campaign.unsuppress(s.email);
  }
});

async function liveAnnualReview() {
  return repos().automation.create({
    name: "Annual review",
    status: "live",
    flow: AUTOMATION_TEMPLATES[0].flow,
    fromBrokerId: "mm",
    createdBy: "mm",
  });
}

/** The cid the runner stamped on the Nth email it sent. */
async function cidOfSend(n: number): Promise<string> {
  const payload = sendMock.mock.calls[n][0] as { unsubscribeUrl: string };
  const token = payload.unsubscribeUrl.split("/api/e/u/")[1];
  const verified = await verifyTrackingToken(token, "unsubscribe");
  if (!verified.ok) throw new Error("the email carried a bad token");
  return verified.claims.cid;
}

/** Tokens exactly as buildRecipientLinks mints them for that email. */
function tokenFor(cid: string, p: "open" | "click", em = "sarah@example.com") {
  return issueTrackingToken({ cid, em, p });
}

const params = (token: string) => ({ params: Promise.resolve({ token }) });

async function open(cid: string) {
  await openRoute.GET(new Request("https://app.example.com/e/o/x"), params(await tokenFor(cid, "open")));
}

async function click(cid: string, url = "https://tidycal.com/book", em?: string) {
  const token = await tokenFor(cid, "click", em);
  await clickRoute.GET(
    new Request(`https://app.example.com/e/c/${token}?u=${encodeURIComponent(url)}`),
    params(token),
  );
}

/** Tick every minute across a stretch, as the cron would. */
async function tickThrough(from: Date, times = 4) {
  let t = from;
  for (let i = 0; i < times; i++) {
    await tickAutomations(t);
    t = new Date(t.getTime() + 60_000);
  }
}

describe("automation links", () => {
  it("name the exact send they were sent in", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);

    const subject = parseTrackingId(await cidOfSend(0));
    const send = await repos().automation.findSend(automation.id, "sarah@example.com");

    expect(subject).toEqual({
      kind: "automation",
      automationId: automation.id,
      sendId: send!.id,
    });
  });

  it("carry an open pixel in the email itself", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    expect((sendMock.mock.calls[0][0] as { html: string }).html).toContain("/e/o/");
  });
});

describe("an open through the real pixel route", () => {
  it("is recorded on the send", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);

    await open(await cidOfSend(0));

    const send = await repos().automation.findSend(automation.id, "sarah@example.com");
    expect(send!.openedAt).toBeInstanceOf(Date);
  });

  it("takes the opened branch, so no follow-up goes out", async () => {
    // The bug in one test: before, this contact got the follow-up
    // written for people who never read the first email.
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);
    await open(await cidOfSend(0));
    sendMock.mockClear();

    await tickThrough(new Date(NOW.getTime() + 6 * DAY));

    expect(sendMock).not.toHaveBeenCalled();
    const [run] = await repos().automation.listRuns(automation.id);
    expect(run.currentNodeId).toBe("exit-opened");
  });
});

describe("a click through the real click route", () => {
  it("counts as an open too, and still forwards", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);

    await click(await cidOfSend(0));

    const send = await repos().automation.findSend(automation.id, "sarah@example.com");
    expect(send!.clickedAt).toBeInstanceOf(Date);
    expect(send!.openedAt).toBeInstanceOf(Date);
    expect(redirected).toEqual(["https://tidycal.com/book"]);
  });

  it("emits contact.clicked once, naming the sequence", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    const cid = await cidOfSend(0);

    await click(cid);
    await click(cid);

    const clicks = emitted.filter((e) => e.event === "contact.clicked");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].data).toMatchObject({
      source: "automation",
      automationName: "Annual review",
      email: "sarah@example.com",
      url: "https://tidycal.com/book",
    });
  });

  it("credits a late click to the email it was in, not the latest one", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    const firstCid = await cidOfSend(0);

    // Unopened, so the follow-up goes out: two emails now exist.
    await tickThrough(new Date(NOW.getTime() + 6 * DAY));
    expect(sendMock).toHaveBeenCalledTimes(2);

    // Then she finds the first one and clicks it.
    await click(firstCid);

    const first = await repos().automation.getSend(
      (parseTrackingId(firstCid) as { sendId: string }).sendId,
    );
    const second = await repos().automation.getSend(
      (parseTrackingId(await cidOfSend(1)) as { sendId: string }).sendId,
    );
    expect(first!.clickedAt).toBeInstanceOf(Date);
    expect(second!.clickedAt).toBeNull();
  });

  it("credits nobody when the send belongs to a different address", async () => {
    // Signed tokens make this hard to reach, which is why it is the
    // kind of thing that goes untested. A send id is not a licence to
    // record against whoever it belongs to.
    await liveAnnualReview();
    await tickAutomations(NOW);
    const cid = await cidOfSend(0);

    expect(await findTrackedMessage(cid, "someone-else@example.com")).toBeNull();

    await click(cid, "https://tidycal.com/book", "someone-else@example.com");
    expect(emitted.filter((e) => e.event === "contact.clicked")).toHaveLength(0);
  });

  it("still resolves links in emails sent before sends were named", async () => {
    // `auto:<id>` with no send. Falls back to the latest send.
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);

    await click(`auto:${automation.id}`);

    const send = await repos().automation.findSend(automation.id, "sarah@example.com");
    expect(send!.clickedAt).toBeInstanceOf(Date);
  });
});

describe("unsubscribing from an automation email", () => {
  it("through the mail client's own button tells other systems", async () => {
    // The one-click route used to suppress and stop there. This is
    // Gmail's and Outlook's own unsubscribe button.
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);
    const oneClick = (sendMock.mock.calls[0][0] as { unsubscribeUrl: string })
      .unsubscribeUrl;
    const token = oneClick.split("/api/e/u/")[1];

    await oneClickRoute.POST(new Request(oneClick, { method: "POST" }), params(token));

    const suppressed = await repos().campaign.suppressedAmong(["sarah@example.com"]);
    expect(suppressed.has("sarah@example.com")).toBe(true);

    const unsub = emitted.find((e) => e.event === "contact.unsubscribed");
    expect(unsub?.data).toMatchObject({
      source: "automation",
      automationName: "Annual review",
      via: "one-click",
    });

    const send = await repos().automation.findSend(automation.id, "sarah@example.com");
    expect(send!.unsubscribedAt).toBeInstanceOf(Date);
  });
});

describe("lifecycle events", () => {
  it("announce the milestone when the trigger enrols someone", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);

    const entered = emitted.filter((e) => e.event === "automation.entered");
    expect(entered).toHaveLength(1);
    expect(entered[0].data).toMatchObject({
      automationName: "Annual review",
      email: "sarah@example.com",
      triggerDescription: "A loan passes its 12-month settlement anniversary",
      trigger: { kind: "settlement-anniversary", months: 12 },
      // From the settled back-book: no open deal.
      dealId: null,
    });
  });

  it("announce each person once, not once per tick", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    await tickAutomations(new Date(NOW.getTime() + 60_000));
    expect(emitted.filter((e) => e.event === "automation.entered")).toHaveLength(1);
  });

  it("report the opened branch as completed, in the author's words", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    await open(await cidOfSend(0));
    await tickThrough(new Date(NOW.getTime() + 6 * DAY));

    const done = emitted.filter((e) => e.event === "automation.completed");
    expect(done).toHaveLength(1);
    expect(done[0].data).toMatchObject({
      endNodeId: "exit-opened",
      outcome:
        "Opened, nothing further. The broker picks it up from the pipeline instead.",
    });
    expect(emitted.some((e) => e.event === "automation.exited")).toBe(false);
  });

  it("report the unopened branch as completed too, on its own ending", async () => {
    // Following up once and stopping is the sequence doing its job.
    // An earlier draft called this "exited", which would have told a
    // receiver that every normal finish was a failure.
    await liveAnnualReview();
    await tickAutomations(NOW);
    await tickThrough(new Date(NOW.getTime() + 6 * DAY), 6);

    const done = emitted.filter((e) => e.event === "automation.completed");
    expect(done).toHaveLength(1);
    expect(done[0].data).toMatchObject({
      endNodeId: "exit-unopened",
      outcome: "Followed up once.",
    });
  });

  it("report an unsubscribe as exited, with the reason", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    await repos().campaign.suppress({ email: "sarah@example.com" });
    await tickThrough(new Date(NOW.getTime() + 6 * DAY), 2);

    const exited = emitted.filter((e) => e.event === "automation.exited");
    expect(exited).toHaveLength(1);
    expect(exited[0].data).toMatchObject({ reason: "unsubscribed" });
    expect(emitted.some((e) => e.event === "automation.completed")).toBe(false);
  });
});

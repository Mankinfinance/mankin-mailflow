import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@/lib/clients/outlook-mime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clients/outlook-mime")>(
    "@/lib/clients/outlook-mime",
  );
  return { ...actual, sendMimeViaGraph: (...a: unknown[]) => sendMock(...a) };
});

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
      // Exactly 12 months before the tick date below.
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

const NOW = new Date("2026-08-25T09:00:00");

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

async function liveAnnualReview() {
  const automation = await repos().automation.create({
    name: "Annual review",
    status: "live",
    flow: AUTOMATION_TEMPLATES[0].flow,
    fromBrokerId: "mm",
    createdBy: "mm",
  });
  return automation;
}

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, mode: "mock" });
  for (const a of await repos().automation.list()) {
    await repos().automation.remove(a.id);
  }
  for (const s of await repos().campaign.listSuppressions()) {
    await repos().campaign.unsuppress(s.email);
  }
});

describe("tickAutomations", () => {
  it("enrols an eligible loan and sends the first email", async () => {
    const automation = await liveAnnualReview();

    const result = await tickAutomations(NOW);

    expect(result.enrolled).toBe(1);
    expect(result.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe("sarah@example.com");
    expect(payload.fromEmail).toBe("michael@mankinfinance.com");
    // Merged, and carrying the unsubscribe footer and header like any
    // other bulk send.
    expect(payload.subject).toContain("Sarah");
    expect(payload.html).toContain("/e/u/");
    expect(payload.unsubscribeUrl).toContain("/api/e/u/");
    expect(payload.text).toBeTruthy();

    const runs = await repos().automation.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].currentNodeId).toBe("wait-5");
  });

  it("never enrols the same person twice", async () => {
    await liveAnnualReview();
    await tickAutomations(NOW);
    sendMock.mockClear();

    const second = await tickAutomations(NOW);

    expect(second.enrolled).toBe(0);
  });

  it("holds at the delay rather than racing ahead", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);
    sendMock.mockClear();

    // One hour later: the five-day wait has not expired.
    await tickAutomations(new Date(NOW.getTime() + 3_600_000));

    expect(sendMock).not.toHaveBeenCalled();
    const runs = await repos().automation.listRuns(automation.id);
    expect(runs[0].currentNodeId).toBe("wait-5");
  });

  it("sends the follow-up when the first email goes unopened", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);
    sendMock.mockClear();

    // Six days on, nothing opened: the delay expires, the condition
    // resolves NO, and the follow-up goes out.
    let later = new Date(NOW.getTime() + 6 * 86_400_000);
    for (let i = 0; i < 4; i++) {
      await tickAutomations(later);
      later = new Date(later.getTime() + 60_000);
    }

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].subject).toContain("still worth a look");
    const runs = await repos().automation.listRuns(automation.id);
    expect(runs[0].status).toBe("done");
  });

  it("takes the opened branch and sends nothing further", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);

    const send = await repos().automation.findSend(automation.id, "sarah@example.com");
    await repos().automation.updateSend(send!.id, {
      openedAt: new Date(NOW.getTime() + 3_600_000),
    });
    sendMock.mockClear();

    let later = new Date(NOW.getTime() + 6 * 86_400_000);
    for (let i = 0; i < 4; i++) {
      await tickAutomations(later);
      later = new Date(later.getTime() + 60_000);
    }

    expect(sendMock).not.toHaveBeenCalled();
    const runs = await repos().automation.listRuns(automation.id);
    expect(runs[0].status).toBe("done");
    expect(runs[0].currentNodeId).toBe("exit-opened");
  });

  it("stops a sequence the moment someone unsubscribes", async () => {
    const automation = await liveAnnualReview();
    await tickAutomations(NOW);
    await repos().campaign.suppress({ email: "sarah@example.com" });
    sendMock.mockClear();

    let later = new Date(NOW.getTime() + 6 * 86_400_000);
    for (let i = 0; i < 3; i++) {
      await tickAutomations(later);
      later = new Date(later.getTime() + 60_000);
    }

    expect(sendMock).not.toHaveBeenCalled();
    const runs = await repos().automation.listRuns(automation.id);
    expect(runs[0].status).toBe("exited");
  });

  it("does not enrol anyone while the sequence is a draft", async () => {
    await repos().automation.create({
      name: "Annual review",
      status: "draft",
      flow: AUTOMATION_TEMPLATES[0].flow,
      fromBrokerId: "mm",
      createdBy: "mm",
    });

    const result = await tickAutomations(NOW);

    expect(result.enrolled).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("leaves someone already suppressed out of the sequence entirely", async () => {
    await liveAnnualReview();
    await repos().campaign.suppress({ email: "sarah@example.com" });

    const result = await tickAutomations(NOW);

    expect(result.enrolled).toBe(0);
  });
});

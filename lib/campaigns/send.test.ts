import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { NewCampaignRecipient } from "@/lib/db/schema";

/** Every send in these tests goes through this stub instead of Graph. */
const sendMock = vi.fn();

vi.mock("@/lib/clients/outlook-mime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clients/outlook-mime")>(
    "@/lib/clients/outlook-mime",
  );
  return { ...actual, sendMimeViaGraph: (...args: unknown[]) => sendMock(...args) };
});

const { dispatchCampaignBatch, dispatchDueCampaigns } = await import("./send");
const { repos } = await import("@/lib/db/repos");
const { OutlookMimeSendError } = await import("@/lib/clients/outlook-mime");

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-campaign-tracking";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

async function makeCampaign(over: Record<string, unknown> = {}) {
  return repos().campaign.create({
    name: "Rate check-in",
    subject: "{{first_name}}, worth a look at your rate",
    body: "Hi {{first_name}},\n\nYour {{lender}} loan is due a review.",
    status: "sending",
    audience: {},
    fromBrokerId: "mm",
    createdBy: "mm",
    trackOpens: true,
    trackClicks: true,
    ...over,
  });
}

function recipient(email: string, over: Partial<NewCampaignRecipient> = {}) {
  return {
    campaignId: "",
    email,
    name: "Sarah Chen",
    firstName: "Sarah",
    sourceKind: "settlements",
    sourceId: `s-${email}`,
    fields: { first_name: "Sarah", lender: "ANZ" },
    ...over,
  } as NewCampaignRecipient;
}

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, mode: "mock" });
  for (const c of await repos().campaign.list()) {
    await repos().campaign.remove(c.id);
  }
  for (const s of await repos().campaign.listSuppressions()) {
    await repos().campaign.unsuppress(s.email);
  }
});

describe("dispatchCampaignBatch", () => {
  it("sends each pending recipient once and marks the campaign sent", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
      recipient("b@example.com"),
    ]);

    const result = await dispatchCampaignBatch(campaign);

    expect(result).toMatchObject({ sent: 2, failed: 0, skipped: 0, complete: true });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect((await repos().campaign.get(campaign.id))?.status).toBe("sent");
  });

  it("sends as the owning broker's mailbox, with both body parts", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [recipient("a@example.com")]);

    await dispatchCampaignBatch(campaign);

    const payload = sendMock.mock.calls[0][0];
    expect(payload.fromEmail).toBe("michael@mankinfinance.com");
    expect(payload.fromName).toBe("Michael Mankin");
    expect(payload.to).toBe("a@example.com");
    // Merge fields resolved, and the unsubscribe footer is on every send.
    expect(payload.subject).toBe("Sarah, worth a look at your rate");
    expect(payload.html).toContain("ANZ");
    expect(payload.html).toContain("/e/u/");
    // A plain-text alternative goes with every send — HTML-only is one
    // of the oldest reliable spam signals.
    expect(payload.text).toContain("ANZ");
  });

  it("hands the sender a one-click unsubscribe endpoint for the header", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [recipient("a@example.com")]);

    await dispatchCampaignBatch(campaign);

    const payload = sendMock.mock.calls[0][0];
    // The header endpoint acts immediately; the body link confirms
    // first. They are different paths on purpose.
    expect(payload.unsubscribeUrl).toContain("/api/e/u/");
    expect(payload.html).toContain("/e/u/");
    expect(payload.html).not.toContain("/api/e/u/");
  });

  it("skips someone who unsubscribed after the audience was resolved", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("gone@example.com"),
      recipient("here@example.com"),
    ]);
    await repos().campaign.suppress({ email: "gone@example.com" });

    const result = await dispatchCampaignBatch(campaign);

    expect(result).toMatchObject({ sent: 1, skipped: 1 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe("here@example.com");

    const skipped = await repos().campaign.findRecipient(
      campaign.id,
      "gone@example.com",
    );
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.skipReason).toBe("suppressed");
  });

  it("records a failure against the recipient and carries on", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("bad@example.com"),
      recipient("good@example.com"),
    ]);
    sendMock.mockImplementation((input: { to: string }) => {
      if (input.to === "bad@example.com") {
        throw new OutlookMimeSendError("Graph returned 550.", {
          status: 550,
          body: "mailbox unavailable",
        });
      }
      return Promise.resolve({ ok: true, mode: "mock" });
    });

    const result = await dispatchCampaignBatch(campaign);

    expect(result).toMatchObject({ sent: 1, failed: 1, complete: true });
    const failed = await repos().campaign.findRecipient(
      campaign.id,
      "bad@example.com",
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("550");
  });

  it("leaves the rest of the queue pending when the batch is full", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
      recipient("b@example.com"),
      recipient("c@example.com"),
    ]);

    const result = await dispatchCampaignBatch(campaign, { batchSize: 2 });

    expect(result).toMatchObject({ sent: 2, complete: false });
    expect((await repos().campaign.get(campaign.id))?.status).toBe("sending");
    expect(await repos().campaign.nextPending(campaign.id, 10)).toHaveLength(1);
  });

  it("never mails the same address twice, even if the audience listed it twice", async () => {
    const campaign = await makeCampaign();
    const landed = await repos().campaign.setRecipients(campaign.id, [
      recipient("dup@example.com", { sourceId: "s-1" }),
      recipient("dup@example.com", { sourceId: "s-2" }),
    ]);

    expect(landed).toBe(1);
    const result = await dispatchCampaignBatch(campaign);
    expect(result.sent).toBe(1);
  });
});

describe("test sends", () => {
  it("redirects the copy to the broker while merging real values", async () => {
    const { sendOneCampaignEmail } = await import("./send");
    const campaign = await makeCampaign();

    await sendOneCampaignEmail({
      campaign,
      recipient: {
        email: "customer@example.com",
        name: "Sarah Chen",
        firstName: "Sarah",
        fields: { first_name: "Sarah", lender: "ANZ" },
        variant: null,
      },
      toOverride: "michael@mankinfinance.com",
    });

    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe("michael@mankinfinance.com");
    // Merged against the customer, so a broken field shows up in the test.
    expect(payload.subject).toContain("Sarah");
  });
});

describe("dispatchDueCampaigns", () => {
  it("spends its run budget across campaigns and leaves the rest queued", async () => {
    const first = await makeCampaign({ name: "First" });
    const second = await makeCampaign({ name: "Second" });
    await repos().campaign.setRecipients(first.id, [
      recipient("a@example.com"),
      recipient("b@example.com"),
    ]);
    await repos().campaign.setRecipients(second.id, [recipient("c@example.com")]);

    const results = await dispatchDueCampaigns(new Date(), { runBudget: 2 });

    // The budget covers the first campaign only; the second waits.
    expect(results).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(await repos().campaign.nextPending(second.id, 10)).toHaveLength(1);
  });

  it("leaves a paused campaign alone", async () => {
    const campaign = await makeCampaign({ status: "paused" });
    await repos().campaign.setRecipients(campaign.id, [recipient("a@example.com")]);

    const results = await dispatchDueCampaigns();

    expect(results).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

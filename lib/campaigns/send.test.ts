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

/* -------------------------------------------------------------------------- */
/* Claiming — what stops two overlapping runs emailing the same people        */
/* -------------------------------------------------------------------------- */

describe("recipient claiming", () => {
  it("does not send twice when two dispatchers overlap", async () => {
    // The cron ticks every five minutes and a run may take longer, so
    // this is the ordinary case rather than a rare race.
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
      recipient("b@example.com"),
      recipient("c@example.com"),
    ]);

    await Promise.all([
      dispatchCampaignBatch(campaign),
      dispatchCampaignBatch(campaign),
    ]);

    const addressed = sendMock.mock.calls.map(
      (c) => (c[0] as { to: string }).to,
    );
    expect(new Set(addressed).size).toBe(addressed.length);
  });

  it("claims a recipient before sending to them", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
    ]);

    const claimed = await repos().campaign.claimPending(campaign.id, 10, 60_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe("sending");
    expect(claimed[0].claimedAt).toBeInstanceOf(Date);

    // A second claim finds nothing, because the first took it.
    expect(await repos().campaign.claimPending(campaign.id, 10, 60_000)).toEqual(
      [],
    );
  });

  it("retakes a claim left behind by a run that died", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
    ]);

    await repos().campaign.claimPending(campaign.id, 10, 60_000);
    // Let the claim age, then treat anything older than a millisecond
    // as abandoned. Nobody is going to finish it, and without this the
    // contact is never emailed at all.
    await new Promise((r) => setTimeout(r, 5));
    const retaken = await repos().campaign.claimPending(campaign.id, 10, 1);
    expect(retaken).toHaveLength(1);
    expect(retaken[0].email).toBe("a@example.com");
  });

  it("releases a claim back to pending", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
    ]);
    const [claimed] = await repos().campaign.claimPending(
      campaign.id,
      10,
      60_000,
    );
    await repos().campaign.releaseClaim(claimed.id);

    const again = await repos().campaign.claimPending(campaign.id, 10, 60_000);
    expect(again).toHaveLength(1);
  });

  it("counts in-flight recipients as unsent", async () => {
    // Otherwise a campaign is called complete — and fires its
    // campaign.sent webhook with the wrong totals — while another
    // dispatcher is still working through its batch.
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
      recipient("b@example.com"),
    ]);

    await repos().campaign.claimPending(campaign.id, 1, 60_000);
    expect(await repos().campaign.countUnsent(campaign.id)).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Opt-out — the part that has to work every time                             */
/* -------------------------------------------------------------------------- */

describe("opt-out", () => {
  it("skips someone who unsubscribed after their batch was claimed", async () => {
    // The window this closes: a contact opts out between the claim and
    // their turn in the loop. Claiming must not freeze the decision.
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("gone@example.com"),
      recipient("still@example.com"),
    ]);
    await repos().campaign.suppress({
      email: "gone@example.com",
      reason: "unsubscribe",
      campaignId: campaign.id,
      addedBy: "customer",
    });

    const result = await dispatchCampaignBatch(campaign);

    expect(result.skipped).toBe(1);
    const addressed = sendMock.mock.calls.map(
      (c) => (c[0] as { to: string }).to,
    );
    expect(addressed).not.toContain("gone@example.com");
    expect(addressed).toContain("still@example.com");
  });

  it("never leaves a suppressed recipient stuck in sending", async () => {
    // A claimed row that is then skipped must reach a terminal status,
    // or it sits claimed forever and the campaign never completes.
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("gone@example.com"),
    ]);
    await repos().campaign.suppress({
      email: "gone@example.com",
      reason: "unsubscribe",
      campaignId: campaign.id,
      addedBy: "customer",
    });

    await dispatchCampaignBatch(campaign);

    const rows = await repos().campaign.listRecipients(campaign.id);
    expect(rows.every((r) => r.status !== "sending")).toBe(true);
    expect(await repos().campaign.countUnsent(campaign.id)).toBe(0);
  });

  it("puts a working unsubscribe link in every email it sends", async () => {
    const campaign = await makeCampaign();
    await repos().campaign.setRecipients(campaign.id, [
      recipient("a@example.com"),
    ]);

    await dispatchCampaignBatch(campaign);

    const [args] = sendMock.mock.calls[0] as [
      { html: string; text: string; unsubscribeUrl: string },
    ];

    // The visible footer link, in both parts of the multipart body.
    expect(args.html).toContain("/e/u/");
    expect(args.text).toContain("/e/u/");

    // And the one-click target the mail client's own unsubscribe
    // button posts to, which is the API route rather than the confirm
    // page: a POST from Gmail must act immediately, where a link a
    // scanner might follow must not.
    expect(args.unsubscribeUrl).toContain("/api/e/u/");
  });
});

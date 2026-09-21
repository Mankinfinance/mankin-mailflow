import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { NewCampaignRecipient } from "@/lib/db/schema";

const listMock = vi.fn();

vi.mock("@/lib/clients/outlook-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clients/outlook-read")>(
    "@/lib/clients/outlook-read",
  );
  return {
    ...actual,
    listRecentBounceMessages: (...args: unknown[]) => listMock(...args),
  };
});

const { reconcileBounces } = await import("./reconcile-bounces");
const { repos } = await import("@/lib/db/repos");
const { OutlookReadError } = await import("@/lib/clients/outlook-read");

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

function ndr(email: string, code = "550 5.1.1 recipient not found") {
  return {
    id: `m-${email}`,
    from: "postmaster@mankinfinance.com",
    subject: "Undeliverable: your rate update",
    body: [
      `Your message to ${email} couldn't be delivered.`,
      "Diagnostic information for administrators:",
      `Remote server returned '${code}'`,
      "From: michael@mankinfinance.com",
      "Cc: support@mankinfinance.com",
    ].join("\n"),
    receivedAt: new Date(),
  };
}

async function seedSentCampaign(emails: string[]) {
  const campaign = await repos().campaign.create({
    name: "Rate note",
    subject: "s",
    body: "b",
    status: "sent",
    audience: {},
    fromBrokerId: "mm",
    createdBy: "mm",
  });
  await repos().campaign.update(campaign.id, { startedAt: new Date() });
  await repos().campaign.setRecipients(
    campaign.id,
    emails.map(
      (email) =>
        ({
          campaignId: campaign.id,
          email,
          name: email,
          firstName: "A",
          sourceKind: "settlements",
          sourceId: email,
          fields: {},
          status: "sent",
          sentAt: new Date(),
        }) as NewCampaignRecipient,
    ),
  );
  return campaign;
}

beforeEach(async () => {
  listMock.mockReset();
  listMock.mockResolvedValue([]);
  for (const c of await repos().campaign.list()) {
    await repos().campaign.remove(c.id);
  }
  for (const s of await repos().campaign.listSuppressions()) {
    await repos().campaign.unsuppress(s.email);
  }
});

describe("reconcileBounces", () => {
  it("suppresses a hard bounce and records why", async () => {
    await seedSentCampaign(["dead@example.com", "fine@example.com"]);
    listMock.mockResolvedValue([ndr("dead@example.com")]);

    const result = await reconcileBounces();

    expect(result.bounces).toBe(1);
    expect(result.suppressed).toBe(1);
    const register = await repos().campaign.listSuppressions();
    expect(register.map((r) => r.email)).toEqual(["dead@example.com"]);
    expect(register[0].reason).toBe("bounce");
  });

  it("never suppresses an address we did not mail", async () => {
    // The safety property: a bounce body quotes our own headers, so
    // michael@ and support@ appear in every NDR. Only addresses in the
    // sent set may ever be removed.
    await seedSentCampaign(["dead@example.com"]);
    listMock.mockResolvedValue([ndr("michael@mankinfinance.com")]);

    const result = await reconcileBounces();

    expect(result.suppressed).toBe(0);
    expect(await repos().campaign.listSuppressions()).toHaveLength(0);
  });

  it("leaves a soft bounce on the list the first time", async () => {
    await seedSentCampaign(["full@example.com"]);
    listMock.mockResolvedValue([ndr("full@example.com", "452 4.2.2 mailbox full")]);

    const result = await reconcileBounces();

    expect(result.softRecorded).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(await repos().campaign.listSuppressions()).toHaveLength(0);
  });

  it("gives up on an address that soft-bounces repeatedly", async () => {
    await seedSentCampaign(["full@example.com"]);
    const soft = ndr("full@example.com", "452 4.2.2 mailbox full");
    listMock.mockResolvedValue([
      { ...soft, id: "m1" },
      { ...soft, id: "m2" },
      { ...soft, id: "m3" },
    ]);

    const result = await reconcileBounces();

    expect(result.suppressed).toBe(1);
  });

  it("writes the reason onto the send record for the report", async () => {
    const campaign = await seedSentCampaign(["dead@example.com"]);
    listMock.mockResolvedValue([ndr("dead@example.com")]);

    await reconcileBounces();

    const recipient = await repos().campaign.findRecipient(
      campaign.id,
      "dead@example.com",
    );
    expect(recipient?.status).toBe("failed");
    expect(recipient?.error).toContain("Hard bounce");
    expect(recipient?.error).toContain("5.1.1");
  });

  it("does not re-suppress someone already on the register", async () => {
    await seedSentCampaign(["dead@example.com"]);
    await repos().campaign.suppress({ email: "dead@example.com", reason: "unsubscribe" });
    listMock.mockResolvedValue([ndr("dead@example.com")]);

    const result = await reconcileBounces();

    expect(result.suppressed).toBe(0);
    // The original opt-out reason survives — it is the one that matters
    // if we are ever asked when we honoured it.
    const register = await repos().campaign.listSuppressions();
    expect(register[0].reason).toBe("unsubscribe");
  });

  it("reports missing consent instead of failing the run", async () => {
    await seedSentCampaign(["dead@example.com"]);
    listMock.mockRejectedValue(
      new OutlookReadError("Graph returned 403", { status: 403 }),
    );

    const result = await reconcileBounces();

    expect(result.needsConsent).toBe(true);
    expect(result.skipped).toHaveLength(1);
    expect(result.suppressed).toBe(0);
  });

  it("ignores campaigns sent outside the matching window", async () => {
    const campaign = await seedSentCampaign(["old@example.com"]);
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 90);
    await repos().campaign.update(campaign.id, { startedAt: longAgo });
    listMock.mockResolvedValue([ndr("old@example.com")]);

    const result = await reconcileBounces();

    // No recent sends, so nothing is eligible and no mailbox is read.
    expect(result.suppressed).toBe(0);
    expect(listMock).not.toHaveBeenCalled();
  });
});

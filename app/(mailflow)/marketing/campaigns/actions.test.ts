import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/current-broker", () => ({
  currentBroker: async () => ({ id: "na", name: "Nathan Austin" }),
}));
vi.mock("@/lib/auth/permissions", () => ({ canAccessAdmin: async () => true }));
vi.mock("@/lib/audit", () => ({ auditLog: async () => {} }));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

const { duplicateCampaignAction } = await import("./actions");
const { repos } = await import("@/lib/db/repos");

describe("duplicateCampaignAction", () => {
  it("copies the email, sender and audience into a fresh draft, and nothing that happened", async () => {
    const original = await repos().campaign.create({
      name: "October rate update",
      subject: "{{first_name}}, rates moved",
      preheader: "What it means for your loan",
      body: "Hi {{first_name}},\n\nRates moved.",
      status: "sent",
      audience: { sources: ["settlements"] },
      fromBrokerId: "mm",
      createdBy: "mm",
      subjectB: "Rates moved this month",
      abTestPercent: 20,
      trackOpens: true,
      trackClicks: false,
    });
    await repos().campaign.update(original.id, {
      startedAt: new Date(),
      scheduledFor: new Date(),
    });

    const result = await duplicateCampaignAction(original.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = (await repos().campaign.get(result.id))!;

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("October rate update (copy)");
    expect(copy.status).toBe("draft");
    expect(copy.subject).toBe(original.subject);
    expect(copy.preheader).toBe("What it means for your loan");
    expect(copy.body).toBe(original.body);
    expect(copy.subjectB).toBe("Rates moved this month");
    expect(copy.abTestPercent).toBe(20);
    expect(copy.trackClicks).toBe(false);
    expect(copy.fromBrokerId).toBe("mm");
    expect(copy.createdBy).toBe("na");
    expect(copy.startedAt).toBeNull();
    expect(copy.scheduledFor).toBeNull();
  });

  it("says so when the campaign is gone", async () => {
    expect(await duplicateCampaignAction("00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
      error: "That campaign no longer exists.",
    });
  });
});

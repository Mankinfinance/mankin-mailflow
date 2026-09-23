import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/current-broker", () => ({
  currentBroker: async () => ({ id: "mm", name: "Michael Mankin" }),
}));
vi.mock("@/lib/auth/permissions", () => ({ canAccessAdmin: async () => true }));
vi.mock("@/lib/audit", () => ({ auditLog: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveSettingsAction, saveSignatureAction } = await import("./actions");
const { currentSettings } = await import("@/lib/mailflow/current-settings");
const { SignatureSchema } = await import("@/lib/mailflow/settings");
const { repos } = await import("@/lib/db/repos");

/* Two forms save to one settings record. Each must leave the other's
   part exactly as stored, or saving the send pace would wipe the
   signature and saving the signature would reset the postal address. */

beforeEach(async () => {
  await repos().settings.save(
    { postalAddress: "Suite 208, Oran Park", unsubscribeMailto: "", trackOpensByDefault: true, trackClicksByDefault: true, batchSize: 60, signature: SignatureSchema.parse({}) },
    "mm",
  );
});

describe("the two settings saves", () => {
  it("saving the signature keeps the postal address and pace", async () => {
    const signature = SignatureSchema.parse({ instagramUrl: "https://www.instagram.com/mankinfinance" });
    expect(await saveSignatureAction(signature)).toEqual({ ok: true });

    const now = await currentSettings();
    expect(now.signature.instagramUrl).toBe("https://www.instagram.com/mankinfinance");
    expect(now.postalAddress).toBe("Suite 208, Oran Park");
    expect(now.batchSize).toBe(60);
  });

  it("saving the other settings keeps the signature, even from a stale form", async () => {
    await saveSignatureAction(SignatureSchema.parse({ linkedinUrl: "https://www.linkedin.com/company/mankin" }));

    // The main form, loaded before the signature was saved, still holds
    // the old signature and sends it back.
    const stale = { ...(await currentSettings()), batchSize: 90, signature: SignatureSchema.parse({}) };
    expect(await saveSettingsAction(stale)).toEqual({ ok: true });

    const now = await currentSettings();
    expect(now.batchSize).toBe(90);
    expect(now.signature.linkedinUrl).toBe("https://www.linkedin.com/company/mankin");
  });

  it("names the field when a signature address is wrong", async () => {
    const result = await saveSignatureAction({
      ...SignatureSchema.parse({}),
      awards: [{ imageUrl: "http://insecure.example.com/a.png", alt: "" }],
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Award 1 image") });
  });
});

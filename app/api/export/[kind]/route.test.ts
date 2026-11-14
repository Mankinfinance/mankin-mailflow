import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewCampaignRecipient } from "@/lib/db/schema";

let admin = true;
const audit = vi.fn(async (_e: unknown) => {});
vi.mock("@/lib/auth/current-broker", () => ({ currentBroker: async () => ({ id: "mm", name: "Michael Mankin" }) }));
vi.mock("@/lib/auth/permissions", () => ({ canAccessAdmin: async () => admin }));
vi.mock("@/lib/audit", () => ({ auditLog: (e: unknown) => audit(e) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));

const { GET } = await import("./route");
const { repos } = await import("@/lib/db/repos");

const get = (kind: string, query = "") =>
  GET(new Request(`https://mail.example.com/api/export/${kind}${query}`), { params: Promise.resolve({ kind }) });

beforeEach(() => {
  admin = true;
  audit.mockClear();
});

describe("CSV exports", () => {
  it("are admin only", async () => {
    admin = false;
    expect((await get("suppressions")).status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
  });

  it("export the register as a download, logged with the row count", async () => {
    await repos().campaign.suppress({ email: "gone@example.com", reason: "unsubscribe", addedBy: "customer" });
    const res = await get("suppressions");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="mailflow-do-not-market-/);
    const csv = await res.text();
    expect(csv).toContain("gone@example.com,Unsubscribe,");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "export.suppressions" }));
  });

  it("export one campaign's results, with a typed-in formula defused", async () => {
    const campaign = await repos().campaign.create({
      name: "Rate check", subject: "s", body: "b", status: "sent", audience: {}, fromBrokerId: "mm", createdBy: "mm",
    });
    await repos().campaign.setRecipients(campaign.id, [
      { campaignId: campaign.id, email: "x@example.com", name: "=HYPERLINK(\"http://evil\")", firstName: "X", sourceKind: "deals", sourceId: "d1", fields: {}, status: "sent", sentAt: new Date() } as NewCampaignRecipient,
    ]);
    const csv = await (await get("campaign", `?id=${campaign.id}`)).text();
    expect(csv).toContain("x@example.com");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect((await get("campaign", "?id=nope")).status).toBe(404);
  });

  it("refuses an unknown export", async () => {
    expect((await get("everything")).status).toBe(404);
  });
});

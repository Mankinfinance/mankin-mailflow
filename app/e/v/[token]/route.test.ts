import { describe, it, expect, beforeAll } from "vitest";
import type { NewCampaignRecipient } from "@/lib/db/schema";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

const { GET } = await import("./route");
const { repos } = await import("@/lib/db/repos");
const { buildRecipientLinks, issueTrackingToken } = await import("@/lib/campaigns/tracking");
const { renderCampaign } = await import("@/lib/campaigns/merge");

async function sentCampaign() {
  const campaign = await repos().campaign.create({
    name: "November update",
    subject: "{{first_name}}, rates moved",
    body: "Hi {{first_name}},\n\nYour {{lender}} loan.",
    status: "sent",
    audience: {},
    fromBrokerId: "mm",
    createdBy: "mm",
  });
  await repos().campaign.setRecipients(campaign.id, [
    {
      campaignId: campaign.id,
      email: "sarah@example.com",
      name: "Sarah Chen",
      firstName: "Sarah",
      sourceKind: "settlements",
      sourceId: "s1",
      fields: { first_name: "Sarah", lender: "Westpac" },
      status: "sent",
      sentAt: new Date(),
    } as NewCampaignRecipient,
  ]);
  return campaign;
}

const call = (token: string) => GET(new Request(`https://mail.example.com/e/v/${token}`), { params: Promise.resolve({ token }) });

describe("view in browser", () => {
  it("is linked from the top of each campaign email", async () => {
    const campaign = await sentCampaign();
    const links = await buildRecipientLinks({ campaignId: campaign.id, email: "sarah@example.com", trackOpens: false, trackClicks: false, webVersion: true });
    expect(links.webVersionUrl).toMatch(/\/e\/v\//);
    const out = renderCampaign({ subject: "s", body: "b", fields: {}, brokerId: "mm", links });
    expect(out.html).toContain("View this email in your browser");
    expect(out.text.startsWith("View this email in your browser:")).toBe(true);
  });

  it("shows that recipient's own copy, privately, and counts it as an open", async () => {
    const campaign = await sentCampaign();
    const res = await call(await issueTrackingToken({ cid: campaign.id, em: "sarah@example.com", p: "view" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Sarah, rates moved</title>");
    expect(html).toContain("Your Westpac loan.");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const r = await repos().campaign.findRecipient(campaign.id, "sarah@example.com");
    expect(r!.openedAt).toBeInstanceOf(Date);
  });

  it("refuses another purpose's token, a forged one, or someone not on the campaign", async () => {
    const campaign = await sentCampaign();
    const click = await issueTrackingToken({ cid: campaign.id, em: "sarah@example.com", p: "click" });
    expect((await call(click)).status).toBe(404);
    expect((await call("not.a.token")).status).toBe(404);
    const stranger = await issueTrackingToken({ cid: campaign.id, em: "someone@example.com", p: "view" });
    expect((await call(stranger)).status).toBe(404);
  });
});

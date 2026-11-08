import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const listMock = vi.fn();
let unsubscribeMailto = "unsubscribe@mankinfinance.com";

vi.mock("@/lib/clients/outlook-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clients/outlook-read")>(
    "@/lib/clients/outlook-read",
  );
  return { ...actual, listRecentMessages: (...args: unknown[]) => listMock(...args) };
});

vi.mock("@/lib/mailflow/current-settings", () => ({
  currentSettings: async () => ({ unsubscribeMailto }),
}));

const { reconcileUnsubscribeMail } = await import("./reconcile-unsubscribes");
const { repos } = await import("@/lib/db/repos");
const { OutlookReadError } = await import("@/lib/clients/outlook-read");

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

const msg = (from: string, subject: string, body = "") => ({
  id: `m-${from}-${subject}`,
  from,
  subject,
  body,
  receivedAt: new Date(),
});

/** Mail per mailbox; anything not listed is empty. */
function inboxes(byMailbox: Record<string, ReturnType<typeof msg>[]>) {
  listMock.mockImplementation(async ({ mailbox }: { mailbox: string }) => byMailbox[mailbox] ?? []);
}

const suppressed = async (emails: string[]) => repos().campaign.suppressedAmong(emails);

describe("reconcileUnsubscribeMail", () => {
  beforeEach(() => {
    listMock.mockReset();
    unsubscribeMailto = "unsubscribe@mankinfinance.com";
  });

  it("unsubscribes anyone who writes to the unsubscribe mailbox", async () => {
    inboxes({ "unsubscribe@mankinfinance.com": [msg("Jane.Citizen@Example.com", "unsubscribe")] });
    const r = await reconcileUnsubscribeMail();
    expect(r.unsubscribed).toBe(1);
    expect(await suppressed(["jane.citizen@example.com"])).toEqual(new Set(["jane.citizen@example.com"]));
  });

  it("unsubscribes a client who replies 'unsubscribe' to a broker, and nobody who just replies", async () => {
    inboxes({
      "michael@mankinfinance.com": [
        msg("bob@example.com", "RE: Your rate review", "Unsubscribe please\n\n> Your rate review"),
        msg("carol@example.com", "RE: Your rate review", "Yes please, call me Thursday\n\n> Unsubscribe"),
      ],
    });
    const r = await reconcileUnsubscribeMail();
    expect(r.unsubscribed).toBe(1);
    expect(await suppressed(["bob@example.com", "carol@example.com"])).toEqual(new Set(["bob@example.com"]));
  });

  it("never unsubscribes staff, out-of-office replies, or someone already on the register", async () => {
    await repos().campaign.suppress({ email: "dan@example.com", reason: "unsubscribe", addedBy: "customer" });
    inboxes({
      "unsubscribe@mankinfinance.com": [
        msg("nathan@mankinfinance.com", "test"),
        msg("erin@example.com", "Automatic reply: unsubscribe", "I'm away"),
        msg("dan@example.com", "unsubscribe"),
      ],
    });
    const r = await reconcileUnsubscribeMail();
    expect(r.unsubscribed).toBe(0);
    expect(await suppressed(["nathan@mankinfinance.com", "erin@example.com"])).toEqual(new Set());
  });

  it("reads only broker inboxes when no unsubscribe mailbox is set", async () => {
    unsubscribeMailto = "";
    inboxes({});
    await reconcileUnsubscribeMail();
    const read = listMock.mock.calls.map((c) => (c[0] as { mailbox: string }).mailbox);
    expect(read).not.toContain("unsubscribe@mankinfinance.com");
    expect(read).toContain("michael@mankinfinance.com");
  });

  it("carries on past a mailbox it can't read, and says so", async () => {
    listMock.mockImplementation(async ({ mailbox }: { mailbox: string }) => {
      if (mailbox === "unsubscribe@mankinfinance.com") throw new OutlookReadError("no", { status: 403 });
      return mailbox === "michael@mankinfinance.com" ? [msg("fay@example.com", "Stop")] : [];
    });
    const r = await reconcileUnsubscribeMail();
    expect(r.needsConsent).toBe(true);
    expect(r.skipped[0].mailbox).toBe("unsubscribe@mankinfinance.com");
    expect(r.unsubscribed).toBe(1);
  });
});

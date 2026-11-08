import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let session: { user?: { email?: string } } | null = null;
let extras: Array<{ id: string; email: string; name: string }> = [];
let permissions: Array<{ teamId: string; isAdmin?: boolean; canAccessCx?: boolean; disabled?: boolean }> = [];

vi.mock("@/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/team-extras", () => ({ listTeamExtras: async () => extras }));
vi.mock("@/lib/team-permissions", () => ({ listTeamPermissions: async () => permissions }));

const { currentBroker, NO_ACCESS_ID } = await import("./current-broker");
const { canAccessAdmin } = await import("./permissions");
const authConfig = (await import("@/auth.config")).default;
const { config: proxyConfig } = await import("@/proxy");

/* currentBroker is wrapped in React cache(); outside a request it just
   calls through, so each call sees the current mocks. */
async function who(email: string | null) {
  session = email ? { user: { email } } : null;
  return currentBroker();
}

describe("currentBroker never hands out Michael by default", () => {
  beforeEach(() => {
    delete process.env.SKIP_AUTH;
    extras = [];
    permissions = [];
  });

  it("knows Michael when Michael signs in", async () => {
    expect((await who("michael@mankinfinance.com")).id).toBe("mm");
  });

  it("gives no access with no session", async () => {
    const b = await who(null);
    expect(b.id).toBe(NO_ACCESS_ID);
    expect(await canAccessAdmin(b.id)).toBe(false);
  });

  it("gives no access to a tenant account that isn't on the team", async () => {
    const b = await who("reception@mankinfinance.com");
    expect(b.id).toBe(NO_ACCESS_ID);
    expect(await canAccessAdmin(b.id)).toBe(false);
  });

  it("doesn't match a team extra by the part before @ from another domain", async () => {
    extras = [{ id: "x1", email: "jane@mankinfinance.com", name: "Jane" }];
    expect((await who("jane@evil.example")).id).toBe(NO_ACCESS_ID);
    expect((await who("jane@mankinfinance.com")).id).toBe("x1");
  });
});

describe("canAccessAdmin", () => {
  it("says no to a disabled admin, so server actions refuse them too", async () => {
    permissions = [{ teamId: "na", isAdmin: true, disabled: true }];
    expect(await canAccessAdmin("na")).toBe(false);
    permissions = [{ teamId: "na", isAdmin: true }];
    expect(await canAccessAdmin("na")).toBe(true);
  });
});

describe("sign-in", () => {
  const signIn = authConfig.callbacks!.signIn! as (a: unknown) => boolean | Promise<boolean>;
  it("lets the firm's accounts in and turns guests away", async () => {
    expect(await signIn({ user: { email: "nathan@mankinfinance.com" } })).toBe(true);
    expect(await signIn({ user: { email: "someone@gmail.com" } })).toBe(false);
    expect(await signIn({ user: {}, profile: {} })).toBe(false);
  });

  it("no longer asks Microsoft for mail or calendar access", () => {
    const providers = JSON.stringify(authConfig.providers);
    expect(providers).toContain("User.Read");
    expect(providers).not.toMatch(/Mail\.|Calendars\.|offline_access/);
  });
});

describe("the sign-in gate's path filter", () => {
  const pattern = new RegExp(`^${proxyConfig.matcher[0]}$`);
  it("checks app pages even when the path ends in .png or .svg", () => {
    expect(pattern.test("/marketing/campaigns/x.png")).toBe(true);
    expect(pattern.test("/marketing/forms/a.svg")).toBe(true);
  });
  it("still skips the real static folders and the cron jobs", () => {
    expect(pattern.test("/brand/logo.png")).toBe(false);
    expect(pattern.test("/icons/icon-192.png")).toBe(false);
    expect(pattern.test("/_next/static/chunks/a.js")).toBe(false);
    expect(pattern.test("/api/cron/campaigns")).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runConnectionTests, type ConnectionDeps } from "./connection-tests";
import { evaluateSenderAuth } from "@/lib/campaigns/sender-auth";

const jwt = (roles: string[]) =>
  `x.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.y`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const goodEnv = {
  DATABASE_URL: "postgres://example",
  MS_GRAPH_TENANT_ID: "tenant",
  MS_GRAPH_CLIENT_ID: "client",
  MS_GRAPH_CLIENT_SECRET: "graph-secret-value",
  ANTHROPIC_API_KEY: "sk-ant-test",
  CRON_SECRET: "a".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://mankin-mailflow.vercel.app",
  AUTH_URL: "https://mankin-mailflow.vercel.app",
};

function deps(over: Partial<ConnectionDeps> & { routes?: Record<string, () => Response> } = {}): ConnectionDeps {
  const routes: Record<string, () => Response> = {
    "login.microsoftonline.com": () => json(200, { access_token: jwt(["Mail.Send", "Mail.Read"]) }),
    "users/michael": () => json(200, { id: "inbox" }),
    "users/nathan": () => json(200, { id: "inbox" }),
    "/api/health": () => json(200, { ok: true }),
    ...over.routes,
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return routes[hit]();
  }) as typeof fetch;
  return {
    env: goodEnv,
    fetch: fetchImpl,
    probeDatabase: async () => ({ reachable: true, error: null, tablesPresent: ["a", "b"], tablesMissing: [], migrationsRecorded: 3, lastMigrationAt: null }),
    retrieveModel: async () => ({}),
    senderAuth: async (domain) =>
      evaluateSenderAuth({
        domain,
        txt: ["v=spf1 include:spf.protection.outlook.com -all"],
        dmarc: ["v=DMARC1; p=quarantine"],
        selector1: "s1.example",
        selector2: "s2.example",
        appUrl: "https://mail.mankinfinance.com",
      }),
    mailboxes: [
      { name: "Michael Mankin", email: "michael@mankinfinance.com" },
      { name: "Nathan Austin", email: "nathan@mankinfinance.com" },
    ],
    model: "claude-sonnet-5",
    ...over,
  };
}

const byKey = async (d: ConnectionDeps) =>
  Object.fromEntries((await runConnectionTests(d)).map((r) => [r.key, r]));

describe("runConnectionTests", () => {
  it("passes everything when every service answers", async () => {
    const results = await runConnectionTests(deps());
    expect(results.map((r) => [r.key, r.status])).toEqual([
      ["database", "pass"],
      ["graph", "pass"],
      ["mailboxes", "pass"],
      ["sending", "pass"],
      ["cron", "pass"],
      ["anthropic", "pass"],
      ["app-url", "pass"],
      ["auth-url", "pass"],
      ["domain", "pass"],
    ]);
  });

  it("never puts a secret in a result", async () => {
    const all = JSON.stringify(await runConnectionTests(deps()));
    for (const secret of ["graph-secret-value", "sk-ant-test", "a".repeat(40), "postgres://example"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("names an expired Microsoft secret, not a generic failure", async () => {
    const r = await byKey(deps({
      routes: { "login.microsoftonline.com": () => json(401, { error: "invalid_client", error_codes: [7000222] }) },
    }));
    expect(r.graph.status).toBe("fail");
    expect(r.graph.detail).toContain("expired");
    expect(r.mailboxes).toBeUndefined();
  });

  it("spots the Secret ID pasted in place of the Value", async () => {
    const r = await byKey(deps({
      routes: { "login.microsoftonline.com": () => json(401, { error: "invalid_client", error_codes: [7000215] }) },
    }));
    expect(r.graph.detail).toContain("Secret ID");
  });

  it("fails sending when Mail.Send was never consented", async () => {
    const r = await byKey(deps({
      routes: { "login.microsoftonline.com": () => json(200, { access_token: jwt(["Mail.Read"]) }) },
    }));
    expect(r.graph.status).toBe("fail");
    expect(r.graph.detail).toContain("Mail.Send");
    expect(r.graph.fix).toContain("Grant admin consent");
  });

  it("names a mailbox an access policy leaves out", async () => {
    const r = await byKey(deps({ routes: { "users/nathan": () => json(403, {}) } }));
    expect(r.mailboxes.status).toBe("warn");
    expect(r.mailboxes.detail).toContain("Nathan Austin");
    expect(r.mailboxes.detail).toContain("1 of 2");
  });

  it("lists every missing Microsoft variable by name", async () => {
    const r = await byKey(deps({ env: { ...goodEnv, MS_GRAPH_CLIENT_SECRET: "", MS_GRAPH_TENANT_ID: undefined } }));
    expect(r.graph.status).toBe("fail");
    expect(r.graph.detail).toContain("MS_GRAPH_TENANT_ID");
    expect(r.graph.detail).toContain("MS_GRAPH_CLIENT_SECRET");
    // Not simulated, but not "working" either: nothing can send.
    expect(r.sending.status).toBe("skip");
  });

  it("points at Deployment Protection when the link address answers 401", async () => {
    const r = await byKey(deps({ routes: { "/api/health": () => json(401, {}) } }));
    expect(r["app-url"].status).toBe("fail");
    expect(r["app-url"].fix).toContain("Deployment Protection");
  });

  it("tells a rejected Anthropic key from an unavailable model", async () => {
    const rejected = await byKey(deps({ retrieveModel: async () => { throw Object.assign(new Error("401"), { status: 401 }); } }));
    expect(rejected.anthropic.detail).toContain("rejected");
    const missingModel = await byKey(deps({ retrieveModel: async () => { throw Object.assign(new Error("404"), { status: 404 }); } }));
    expect(missingModel.anthropic.detail).toContain("claude-sonnet-5");
  });

  it("fails the link address when it is LoanFlow's", async () => {
    const r = await byKey(deps({ env: { ...goodEnv, NEXT_PUBLIC_APP_URL: "https://mankin-followup.vercel.app" } }));
    expect(r["app-url"].status).toBe("fail");
    expect(r["app-url"].detail).toContain("LoanFlow");
  });

  it("fails a link address that does not load yet, such as a new domain before its DNS", async () => {
    const r = await byKey(deps({
      env: { ...goodEnv, NEXT_PUBLIC_APP_URL: "https://mail.mankinfinance.com" },
      routes: { "/api/health": () => { throw new Error("getaddrinfo ENOTFOUND"); } },
    }));
    expect(r["app-url"].status).toBe("fail");
    expect(r["app-url"].fix).toContain("DNS");
  });

  it("warns when sending is only simulated, and fails with no cron secret", async () => {
    const r = await byKey(deps({ env: { ...goodEnv, MOCK_OUTLOOK_SEND: "true", CRON_SECRET: "" } }));
    expect(r.sending.status).toBe("warn");
    expect(r.cron.status).toBe("fail");
  });

  it("fails the database when MOCK_DB forces memory, and warns on missing tables", async () => {
    expect((await byKey(deps({ env: { ...goodEnv, MOCK_DB: "true" } }))).database.status).toBe("fail");
    const r = await byKey(deps({
      probeDatabase: async () => ({ reachable: true, error: null, tablesPresent: [], tablesMissing: ["campaigns"], migrationsRecorded: 0, lastMigrationAt: null }),
    }));
    expect(r.database.status).toBe("warn");
    expect(r.database.fix).toContain("Set up the tables");
  });

  it("keeps going when one check throws unexpectedly", async () => {
    const results = await runConnectionTests(deps({ probeDatabase: async () => { throw new Error("boom"); } }));
    expect(results.find((r) => r.key === "database")?.status).toBe("fail");
    expect(results.find((r) => r.key === "graph")?.status).toBe("pass");
  });
});

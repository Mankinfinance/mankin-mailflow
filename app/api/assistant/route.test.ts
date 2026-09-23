import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const access = { disabled: false, admin: true };
const audited: Array<{ action: string; meta: Record<string, unknown> }> = [];

vi.mock("@/lib/auth/current-broker", () => ({
  currentBroker: async () => ({ id: "mm", name: "Michael Mankin" }),
}));
vi.mock("@/lib/auth/permissions", () => ({
  isUserDisabled: async () => access.disabled,
  canAccessAdmin: async () => access.admin,
}));
vi.mock("@/lib/audit", () => ({
  auditLog: async (entry: { action: string; meta: Record<string, unknown> }) => {
    audited.push(entry);
  },
}));
/* The route's own behaviour is under test, not Claude's: the loop is
   replaced with one that echoes a lookup and an answer. */
vi.mock("@/lib/assistant/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/run")>(
    "@/lib/assistant/run",
  );
  return {
    ...actual,
    runAssistant: async function* () {
      yield { type: "activity", label: "Checking campaigns", tool: "list_campaigns" };
      yield { type: "text", delta: "All good." };
      yield { type: "done", rounds: 2 };
    },
  };
});

const { POST } = await import("./route");

const KEEP = { ...process.env };
beforeEach(() => {
  access.disabled = false;
  access.admin = true;
  audited.length = 0;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  delete process.env.MOCK_CHAT;
});
afterEach(() => {
  process.env = { ...KEEP };
});

const ask = (body: unknown) =>
  POST(
    new Request("https://app.example.com/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const question = {
  messages: [{ role: "user", content: "How did Sarah Chen's refinance campaign do?" }],
  page: "/marketing",
};

describe("POST /api/assistant", () => {
  it("turns away anyone who may not use Mailflow", async () => {
    access.admin = false;
    expect((await ask(question)).status).toBe(403);
    access.admin = true;
    access.disabled = true;
    expect((await ask(question)).status).toBe(403);
  });

  it("says plainly when it has not been switched on", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await ask(question);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.setup).toBe(true);
    expect(body.error).toContain("ANTHROPIC_API_KEY");
  });

  it("refuses a conversation that doesn't end with a question", async () => {
    const response = await ask({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });
    expect(response.status).toBe(400);
  });

  it("streams the reply as newline-delimited events", async () => {
    const response = await ask(question);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["activity", "text", "done"]);
  });

  it("audits what was looked up, never what was asked", async () => {
    // A question can name a client; the audit log is not where that goes.
    await (await ask(question)).text();
    const entry = audited.find((a) => a.action === "assistant.ask");
    expect(entry?.meta).toMatchObject({ ok: true, rounds: 2, tools: ["list_campaigns"] });
    expect(JSON.stringify(entry)).not.toContain("Sarah Chen");
  });
});

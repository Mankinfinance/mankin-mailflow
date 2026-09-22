import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createHmac, timingSafeEqual } from "node:crypto";

/* The SSRF guard blocks anything that is not a public HTTPS host, which
   is exactly right and also means a delivery cannot be tested against a
   local server. Stubbed to allow one known host so the dispatch path
   itself is exercised; safe-url has its own tests. */
vi.mock("./safe-url", () => ({
  checkWebhookUrl: async (raw: string) =>
    raw.startsWith("https://receiver.test/")
      ? { ok: true, url: raw }
      : { ok: false, reason: "blocked in test" },
  isPrivateAddress: () => false,
}));

import { drainWebhooks, emitWebhook } from "./dispatch";
import { repos } from "@/lib/db/repos";
import { REPLAY_WINDOW_SECONDS } from "./signature";
import { MAX_ATTEMPTS } from "./retry";

const SECRET = "whsec_test";
const URL_OK = "https://receiver.test/hook";

/** What the last request actually carried, as a receiver would see it. */
let lastRequest: { url: string; headers: Record<string, string>; body: string } | null;

function stubFetch(respond: (n: number) => { status: number; body?: string }) {
  let calls = 0;
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls += 1;
    lastRequest = {
      url: String(url),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: String(init?.body ?? ""),
    };
    const { status, body } = respond(calls);
    /* 204 and 304 are null-body statuses — constructing a Response
       with any body, including "", throws. A receiver answering 204 is
       the common case, so the stub has to get this right. */
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : (body ?? ""), { status });
  });
}

async function makeEndpoint(events: string[] = ["contact.unsubscribed"]) {
  return repos().webhook.createEndpoint({
    name: "CRM",
    config: { url: URL_OK, events, description: "" },
    secret: SECRET,
    enabled: true,
    createdBy: "mm",
  });
}

beforeEach(() => {
  lastRequest = null;
  /* The mock repo bundle is a module singleton keyed on globalThis, so
     endpoints created by one test are still there for the next and the
     drain picks up their deliveries. Dropping it rebuilds with empty
     stores, which is what "each test starts clean" means here. */
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("mankin.repos")];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("emitWebhook", () => {
  it("queues one delivery per subscribed endpoint", async () => {
    const a = await makeEndpoint();
    const b = await makeEndpoint();
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    expect(await repos().webhook.listDeliveries(a.id)).toHaveLength(1);
    expect(await repos().webhook.listDeliveries(b.id)).toHaveLength(1);
  });

  it("skips endpoints not subscribed to that event", async () => {
    const e = await makeEndpoint(["campaign.sent"]);
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    expect(await repos().webhook.listDeliveries(e.id)).toHaveLength(0);
  });

  it("skips a paused endpoint", async () => {
    const e = await makeEndpoint();
    await repos().webhook.updateEndpoint(e.id, { enabled: false });
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    expect(await repos().webhook.listDeliveries(e.id)).toHaveLength(0);
  });

  it("never throws, so a queue failure cannot undo the thing that happened", async () => {
    // Losing an unsubscribe because a webhook could not be queued
    // would be far worse than a missed notification.
    const spy = vi
      .spyOn(repos().webhook, "endpointsFor")
      .mockRejectedValueOnce(new Error("database is on fire"));
    await expect(
      emitWebhook("contact.unsubscribed", { email: "x@y.com" }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("drainWebhooks", () => {
  it("signs the body so a receiver can verify it", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 200 })));
    await emitWebhook("contact.unsubscribed", { email: "sarah@example.com" });
    await drainWebhooks();

    expect(lastRequest).not.toBeNull();
    const ts = Number(lastRequest!.headers["x-mailflow-timestamp"]);
    const mac = createHmac("sha256", SECRET);
    mac.update(`${ts}.${lastRequest!.body}`);
    const expected = `sha256=${mac.digest("hex")}`;
    const got = lastRequest!.headers["x-mailflow-signature"];
    expect(
      timingSafeEqual(Buffer.from(expected), Buffer.from(got)),
    ).toBe(true);
    expect(Math.abs(Math.floor(Date.now() / 1000) - ts)).toBeLessThan(
      REPLAY_WINDOW_SECONDS,
    );
  });

  it("carries the event and a stable delivery id", async () => {
    await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 200 })));
    await emitWebhook("contact.unsubscribed", { email: "sarah@example.com" });
    await drainWebhooks();

    const envelope = JSON.parse(lastRequest!.body);
    expect(lastRequest!.headers["x-mailflow-event"]).toBe("contact.unsubscribed");
    expect(envelope.event).toBe("contact.unsubscribed");
    expect(envelope.data.email).toBe("sarah@example.com");
    expect(envelope.attempt).toBe(1);
    expect(envelope.id).toBe(lastRequest!.headers["x-mailflow-delivery"]);
  });

  it("never follows a redirect", async () => {
    // An allowed host that 302s to 127.0.0.1 is the classic bypass for
    // the whole SSRF check.
    const fetchMock = stubFetch(() => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await makeEndpoint();
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    await drainWebhooks();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("marks a 2xx delivered and clears the failure streak", async () => {
    const e = await makeEndpoint();
    await repos().webhook.updateEndpoint(e.id, { consecutiveFailures: 4 });
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 204 })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    const result = await drainWebhooks();
    expect(result.delivered).toBe(1);
    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.status).toBe("delivered");
    expect((await repos().webhook.getEndpoint(e.id))!.consecutiveFailures).toBe(0);
  });

  it("retries a 500 and counts the failure", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 500, body: "boom" })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    const result = await drainWebhooks();
    expect(result.retrying).toBe(1);
    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.status).toBe("pending");
    expect(delivery.attempts).toBe(1);
    expect(delivery.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await repos().webhook.getEndpoint(e.id))!.consecutiveFailures).toBe(1);
  });

  it("gives up immediately on a 404, which retrying cannot fix", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 404 })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    const result = await drainWebhooks();
    expect(result.abandoned).toBe(1);
    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.status).toBe("abandoned");
    expect(delivery.nextAttemptAt).toBeNull();
  });

  it("abandons after the last attempt rather than retrying forever", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 503 })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      /* Drain at a time well past any backoff so each pass picks it up. */
      await drainWebhooks(new Date(Date.now() + (i + 1) * 86_400_000));
    }
    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.attempts).toBe(MAX_ATTEMPTS);
    expect(delivery.status).toBe("abandoned");
  });

  it("does not attempt a delivery before its backoff has expired", async () => {
    const e = await makeEndpoint();
    const fetchMock = stubFetch(() => ({ status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });

    await drainWebhooks();
    const before = fetchMock.mock.calls.length;
    await drainWebhooks(); // immediately again — still inside the backoff
    expect(fetchMock.mock.calls.length).toBe(before);
    expect((await repos().webhook.listDeliveries(e.id))[0].attempts).toBe(1);
  });

  it("records a network failure with no status", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    await drainWebhooks();

    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.lastStatus).toBeNull();
    expect(delivery.lastError).toMatch(/ECONNREFUSED/);
    expect(delivery.status).toBe("pending");
  });

  it("abandons a delivery whose endpoint was paused while it waited", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 200 })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    await repos().webhook.updateEndpoint(e.id, { enabled: false });

    const result = await drainWebhooks();
    expect(result.abandoned).toBe(1);
    expect(result.attempted).toBe(0);
  });

  it("refuses to send to a URL the guard rejects, without a request", async () => {
    const fetchMock = stubFetch(() => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const e = await repos().webhook.createEndpoint({
      name: "Internal",
      config: { url: "https://10.0.0.5/hook", events: ["contact.unsubscribed"], description: "" },
      secret: SECRET,
      enabled: true,
      createdBy: "mm",
    });
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    await drainWebhooks();

    expect(fetchMock).not.toHaveBeenCalled();
    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.lastError).toMatch(/blocked/);
  });

  it("caps how much of an error response it stores", async () => {
    const e = await makeEndpoint();
    vi.stubGlobal("fetch", stubFetch(() => ({ status: 500, body: "x".repeat(50_000) })));
    await emitWebhook("contact.unsubscribed", { email: "x@y.com" });
    await drainWebhooks();

    const [delivery] = await repos().webhook.listDeliveries(e.id);
    expect(delivery.lastError!.length).toBeLessThan(3000);
  });
});

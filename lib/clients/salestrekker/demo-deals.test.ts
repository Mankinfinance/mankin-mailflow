import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * The demo deals must never reach a production audience.
 *
 * They carry real-looking addresses at real domains and stand in
 * whenever the imported-deals table is empty. In production that would
 * put them in the "live pipeline", where a campaign would email them.
 */

vi.mock("@/lib/imported-deals-store", () => ({
  getImportedDeals: async () => [],
  getImportedDeal: async () => null,
  updateImportedDeal: async () => {},
}));

const KEEP = process.env.VERCEL_ENV;
afterEach(() => {
  if (KEEP === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = KEEP;
  vi.resetModules();
});

/** A fresh client, since the module keeps one per process. */
async function freshClient() {
  vi.resetModules();
  const { getSalestrekkerClient } = await import("./index");
  return getSalestrekkerClient();
}

describe("demo deals", () => {
  it("are not served on a production deployment", async () => {
    process.env.VERCEL_ENV = "production";
    const client = await freshClient();
    expect(await client.listDeals()).toEqual([]);
  });

  it("still fill in locally and on previews, for building and demos", async () => {
    process.env.VERCEL_ENV = "preview";
    const client = await freshClient();
    expect((await client.listDeals()).length).toBeGreaterThan(0);
  });
});

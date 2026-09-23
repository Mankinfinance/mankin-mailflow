import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * That emitWebhook hands every event to the Salestrekker notes, and
 * that the switch really switches it off.
 */

const noted = vi.fn(async () => ({ noted: true }));

vi.mock("@/lib/integrations/salestrekker-notes", () => ({
  noteOnSalestrekker: (...a: unknown[]) => noted(...(a as [])),
}));

const { emitWebhook } = await import("./dispatch");

/* Outside a request there is no response to wait for, so the note runs
   straight away rather than via `after` — but still without being
   awaited by emitWebhook. One turn of the event loop lets it land. */
const settle = () => new Promise((r) => setImmediate(r));

const KEEP = process.env.SALESTREKKER_NOTES;

beforeEach(() => noted.mockClear());
afterEach(() => {
  if (KEEP === undefined) delete process.env.SALESTREKKER_NOTES;
  else process.env.SALESTREKKER_NOTES = KEEP;
});

describe("Salestrekker notes from emitWebhook", () => {
  it("receive every event, with its data", async () => {
    delete process.env.SALESTREKKER_NOTES;
    await emitWebhook("contact.clicked", { email: "sarah@example.com" });
    await settle();
    expect(noted).toHaveBeenCalledWith("contact.clicked", {
      email: "sarah@example.com",
    });
  });

  it("are off when SALESTREKKER_NOTES is false", async () => {
    process.env.SALESTREKKER_NOTES = "false";
    await emitWebhook("contact.clicked", { email: "sarah@example.com" });
    await settle();
    expect(noted).not.toHaveBeenCalled();
  });

  it("never hold up the thing that emitted", async () => {
    // The whole reason for `after`: an unsubscribe confirmation or a
    // click redirect must not wait on a CRM. A note that never returns
    // must not stop emitWebhook returning.
    delete process.env.SALESTREKKER_NOTES;
    noted.mockImplementationOnce(() => new Promise(() => {}));
    await expect(
      Promise.race([
        emitWebhook("contact.unsubscribed", { email: "sarah@example.com" }).then(
          () => "returned",
        ),
        new Promise((r) => setTimeout(() => r("stuck"), 500)),
      ]),
    ).resolves.toBe("returned");
  });
});

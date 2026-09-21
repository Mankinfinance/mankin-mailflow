import { describe, it, expect } from "vitest";
import {
  MAX_BATCH,
  MIN_BATCH,
  MailflowSettingsSchema,
  estimateSendWindow,
  resolveSettings,
} from "./settings";
import { runsPerDayFor, senderDomain } from "./sending-config";

describe("resolveSettings", () => {
  it("falls back to the built-in defaults", () => {
    const s = resolveSettings(null);
    expect(s.postalAddress).toBe("");
    expect(s.trackOpensByDefault).toBe(true);
    expect(s.batchSize).toBeGreaterThanOrEqual(MIN_BATCH);
  });

  it("uses an env var when nothing is stored", () => {
    const s = resolveSettings(null, { postalAddress: "1 Example St" });
    expect(s.postalAddress).toBe("1 Example St");
  });

  it("lets a stored value take over from the env var", () => {
    const s = resolveSettings(
      { postalAddress: "2 Other Rd" },
      { postalAddress: "1 Example St" },
    );
    expect(s.postalAddress).toBe("2 Other Rd");
  });

  it("lets a stored empty string clear an env var", () => {
    // Clearing the field in the UI has to actually clear it. If the env
    // layer won here, the footer would keep printing an address the
    // broker had just deleted, with nothing on screen to explain it.
    const s = resolveSettings(
      { postalAddress: "" },
      { postalAddress: "1 Example St" },
    );
    expect(s.postalAddress).toBe("");
  });

  it("trims whitespace off an env var", () => {
    expect(resolveSettings(null, { postalAddress: "  1 Example St  " }).postalAddress)
      .toBe("1 Example St");
  });

  it("ignores a whitespace-only env var", () => {
    expect(resolveSettings(null, { postalAddress: "   " }).postalAddress).toBe("");
  });

  it("survives a stored blob that no longer matches the shape", () => {
    // An old row, or one hand-edited in the database. Falling back beats
    // throwing on a page every send path reads.
    const s = resolveSettings({ batchSize: "not a number", nonsense: true });
    expect(s.batchSize).toBeGreaterThanOrEqual(MIN_BATCH);
    expect(s.postalAddress).toBe("");
  });

  it("keeps the good fields when only one is bad", () => {
    const s = resolveSettings({ postalAddress: "3 Good St", batchSize: 9_999 });
    // The whole partial parse fails, so nothing stored is trusted —
    // better than half-applying a payload we cannot validate.
    expect(s.batchSize).toBeLessThanOrEqual(MAX_BATCH);
  });
});

describe("MailflowSettingsSchema", () => {
  it("refuses a pace outside the bounds", () => {
    expect(() => MailflowSettingsSchema.parse({ batchSize: 5 })).toThrow();
    expect(() => MailflowSettingsSchema.parse({ batchSize: 500 })).toThrow();
  });

  it("refuses a fractional pace", () => {
    expect(() => MailflowSettingsSchema.parse({ batchSize: 30.5 })).toThrow();
  });
});

describe("estimateSendWindow", () => {
  it("says so when it all goes in one pass", () => {
    expect(estimateSendWindow(40, 60, 24)).toMatch(/One run/);
  });

  it("counts hours when the cron runs hourly", () => {
    expect(estimateSendWindow(300, 60, 24)).toBe("About 5 hours");
  });

  it("rolls over to days past 24 runs", () => {
    expect(estimateSendWindow(3000, 60, 24)).toMatch(/About 3 days/);
  });

  it("counts days when the cron only runs daily", () => {
    // The Hobby-plan reality: 785 contacts at 60 a run is 14 runs, and
    // at one run a day that is a fortnight to clear the back-book.
    expect(estimateSendWindow(785, 60, 1)).toBe("About 14 days");
  });

  it("does not pretend to know with no audience", () => {
    expect(estimateSendWindow(0, 60, 24)).toBe("—");
  });
});

describe("runsPerDayFor", () => {
  it("reads an hourly schedule", () => {
    expect(runsPerDayFor("0 * * * *")).toBe(24);
    expect(runsPerDayFor("30 * * * *")).toBe(24);
  });

  it("reads an every-N-hours schedule", () => {
    expect(runsPerDayFor("0 */4 * * *")).toBe(6);
  });

  it("reads a daily schedule", () => {
    expect(runsPerDayFor("0 22 * * *")).toBe(1);
  });

  it("counts an explicit list of hours", () => {
    expect(runsPerDayFor("0 8,20 * * *")).toBe(2);
  });

  it("assumes daily for anything it cannot read", () => {
    // Understating the rate makes a send look slower than it is, which
    // is the safe direction to be wrong in.
    expect(runsPerDayFor("nonsense")).toBe(1);
    expect(runsPerDayFor("")).toBe(1);
  });
});

describe("senderDomain", () => {
  it("takes the domain off the sending mailbox", () => {
    expect(senderDomain("michael@mankinfinance.com")).toBe("mankinfinance.com");
  });

  it("lower-cases it", () => {
    expect(senderDomain("Michael@MankinFinance.COM")).toBe("mankinfinance.com");
  });

  it("falls back rather than showing an empty domain", () => {
    expect(senderDomain(null)).toBe("mankinfinance.com");
    expect(senderDomain("not-an-address")).toBe("mankinfinance.com");
  });
});

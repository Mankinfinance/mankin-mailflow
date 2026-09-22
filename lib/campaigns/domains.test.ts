import { describe, it, expect } from "vitest";
import {
  MIN_FOR_RATE,
  buildDomainBreakdown,
  describeOutlier,
  providerFor,
  type DomainRecipientInput,
} from "./domains";

function recipients(
  spec: Array<{ email: string; n: number; opened?: number; clicked?: number; failed?: number }>,
): DomainRecipientInput[] {
  const out: DomainRecipientInput[] = [];
  for (const s of spec) {
    for (let i = 0; i < s.n; i++) {
      /* Failures come off the end so they do not overlap the opens,
         which are drawn from the front — otherwise the fixture makes
         the same recipients both bounce and open. */
      const failed = i >= s.n - (s.failed ?? 0);
      out.push({
        email: `person${i}@${s.email}`,
        status: failed ? "failed" : "sent",
        openedAt: !failed && i < (s.opened ?? 0) ? new Date() : null,
        clickedAt: !failed && i < (s.clicked ?? 0) ? new Date() : null,
      });
    }
  }
  return out;
}

describe("providerFor", () => {
  it("groups a provider's domains together", () => {
    // Outlook, Hotmail and Live are one filter. Splitting them would
    // divide the evidence three ways.
    expect(providerFor("a@outlook.com")).toBe("Outlook / Hotmail");
    expect(providerFor("a@hotmail.com.au")).toBe("Outlook / Hotmail");
    expect(providerFor("a@live.com")).toBe("Outlook / Hotmail");
    expect(providerFor("a@gmail.com")).toBe("Gmail");
    expect(providerFor("a@googlemail.com")).toBe("Gmail");
    expect(providerFor("a@bigpond.com")).toBe("Bigpond / Telstra");
  });

  it("puts a business domain under Other", () => {
    expect(providerFor("michael@mankinfinance.com")).toBe("Other");
  });

  it("is case-insensitive and tolerant of a malformed address", () => {
    expect(providerFor("A@GMAIL.COM")).toBe("Gmail");
    expect(providerFor("no-at-sign")).toBe("Other");
    expect(providerFor("trailing@")).toBe("Other");
  });
});

describe("buildDomainBreakdown", () => {
  it("counts sends, opens and clicks per provider", () => {
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 100, opened: 40, clicked: 10 },
        { email: "bigpond.com", n: 50, opened: 30, clicked: 8 },
      ]),
    );
    const gmail = b.rows.find((r) => r.provider === "Gmail")!;
    expect(gmail.sent).toBe(100);
    expect(gmail.opened).toBe(40);
    expect(gmail.openRate).toBeCloseTo(40);
    expect(gmail.clickRate).toBeCloseTo(10);
  });

  it("orders by volume, so the provider that matters most reads first", () => {
    const b = buildDomainBreakdown(
      recipients([
        { email: "bigpond.com", n: 30, opened: 10 },
        { email: "gmail.com", n: 200, opened: 60 },
      ]),
    );
    expect(b.rows[0].provider).toBe("Gmail");
  });

  it("withholds a rate below the readable floor", () => {
    // On eight recipients one extra open moves the rate twelve points.
    const b = buildDomainBreakdown(
      recipients([{ email: "icloud.com", n: MIN_FOR_RATE - 1, opened: 3 }]),
    );
    const row = b.rows[0];
    expect(row.sent).toBe(MIN_FOR_RATE - 1);
    expect(row.opened).toBe(3);
    expect(row.openRate).toBeNull();
    expect(row.clickRate).toBeNull();
  });

  it("shows a rate at exactly the floor", () => {
    const b = buildDomainBreakdown(
      recipients([{ email: "icloud.com", n: MIN_FOR_RATE, opened: 5 }]),
    );
    expect(b.rows[0].openRate).toBeCloseTo(25);
  });

  it("counts a failed send without letting it drag the open rate down", () => {
    // A hard bounce never reached a mailbox, so it is not a failure to
    // open — it belongs in its own column.
    const b = buildDomainBreakdown(
      recipients([{ email: "gmail.com", n: 30, opened: 10, failed: 10 }]),
    );
    const gmail = b.rows[0];
    expect(gmail.failed).toBe(10);
    expect(gmail.sent).toBe(20);
    expect(gmail.openRate).toBeCloseTo(50);
  });

  it("ignores recipients that never went out", () => {
    // Suppressed and duplicate addresses reached no provider at all.
    const skipped: DomainRecipientInput[] = [
      { email: "a@gmail.com", status: "skipped", openedAt: null, clickedAt: null },
      { email: "b@gmail.com", status: "pending", openedAt: null, clickedAt: null },
    ];
    const b = buildDomainBreakdown([
      ...recipients([{ email: "gmail.com", n: 25, opened: 5 }]),
      ...skipped,
    ]);
    expect(b.rows[0].sent).toBe(25);
  });

  it("counts how many distinct domains Other covers", () => {
    const b = buildDomainBreakdown([
      { email: "a@one.com.au", status: "sent", openedAt: null, clickedAt: null },
      { email: "b@two.com.au", status: "sent", openedAt: null, clickedAt: null },
      { email: "c@two.com.au", status: "sent", openedAt: null, clickedAt: null },
    ]);
    const other = b.rows.find((r) => r.provider === "Other")!;
    expect(other.sent).toBe(3);
    expect(other.distinctDomains).toBe(2);
  });
});

describe("the baseline and the outlier line", () => {
  it("pools the readable providers rather than averaging their rates", () => {
    // A provider with 300 recipients and one with 25 should not carry
    // equal weight in the number the others are compared to.
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 300, opened: 30 },
        { email: "icloud.com", n: 25, opened: 20 },
      ]),
    );
    // Pooled: 50/325 = 15.4%. A mean of the two rates would be 45%.
    expect(b.baselineOpenRate).toBeCloseTo(15.4, 1);
  });

  it("says nothing when every provider is in the ordinary range", () => {
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 100, opened: 40 },
        { email: "bigpond.com", n: 100, opened: 44 },
      ]),
    );
    expect(b.hasOutlier).toBe(false);
    expect(describeOutlier(b)).toBeNull();
  });

  it("names the provider when one is far below the rest", () => {
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 200, opened: 12 },
        { email: "bigpond.com", n: 200, opened: 110 },
      ]),
    );
    expect(b.hasOutlier).toBe(true);
    const line = describeOutlier(b);
    expect(line).toMatch(/Gmail/);
    expect(line).toMatch(/filtering/);
    expect(line).toMatch(/SPF, DKIM and DMARC/);
  });

  it("does not cry filtering over an ordinary few points", () => {
    // Providers differ for dull reasons — image blocking, app defaults.
    // A line that fires at every wobble stops being read.
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 150, opened: 45 },
        { email: "bigpond.com", n: 150, opened: 60 },
      ]),
    );
    expect(b.hasOutlier).toBe(false);
  });

  it("does not flag an outlier on a sample too small to read", () => {
    const b = buildDomainBreakdown(
      recipients([
        { email: "gmail.com", n: 200, opened: 80 },
        { email: "icloud.com", n: 5, opened: 0 },
      ]),
    );
    expect(b.hasOutlier).toBe(false);
  });

  it("has no baseline when nothing reaches the floor", () => {
    const b = buildDomainBreakdown(recipients([{ email: "gmail.com", n: 4, opened: 1 }]));
    expect(b.baselineOpenRate).toBeNull();
    expect(describeOutlier(b)).toBeNull();
  });
});

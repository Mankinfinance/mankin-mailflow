import { describe, it, expect } from "vitest";
import { buildSendingHealth, describeBand } from "./sending-health";
import type { CampaignRecipientRow, EmailSuppressionRow } from "@/lib/db/schema";

const SINCE = new Date("2026-07-26");
const NOW = new Date("2026-08-25");
const OLD = new Date("2026-06-01");

function recipients(
  count: number,
  over: Partial<CampaignRecipientRow> = {},
): CampaignRecipientRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    status: "sent",
    sentAt: NOW,
    unsubscribedAt: null,
    ...over,
  })) as CampaignRecipientRow[];
}

function suppressions(
  count: number,
  over: Partial<EmailSuppressionRow> = {},
): EmailSuppressionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    email: `s${i}@example.com`,
    reason: "bounce",
    createdAt: NOW,
    ...over,
  })) as EmailSuppressionRow[];
}

describe("buildSendingHealth", () => {
  it("reads a clean send as healthy", () => {
    const health = buildSendingHealth({
      recipients: recipients(500),
      suppressions: [],
      since: SINCE,
    });
    expect(health.delivered).toBe(500);
    expect(health.overall).toBe("good");
    expect(health.unsubscribe.rate).toBe(0);
  });

  it("flags an unsubscribe rate above one percent", () => {
    const health = buildSendingHealth({
      recipients: [
        ...recipients(490),
        ...recipients(10, { unsubscribedAt: NOW }),
      ],
      suppressions: [],
      since: SINCE,
    });
    expect(health.unsubscribe.rate).toBeCloseTo(0.02);
    expect(health.unsubscribe.band).toBe("act");
    expect(health.overall).toBe("act");
  });

  it("puts a middling unsubscribe rate on watch rather than alarm", () => {
    const health = buildSendingHealth({
      recipients: [...recipients(496), ...recipients(4, { unsubscribedAt: NOW })],
      suppressions: [],
      since: SINCE,
    });
    expect(health.unsubscribe.band).toBe("watch");
  });

  it("counts bounces off the register, where reconciliation writes them", () => {
    // A bounce can arrive days after the send, so the recipient row is
    // not where it lands.
    const health = buildSendingHealth({
      recipients: recipients(100),
      suppressions: suppressions(6),
      since: SINCE,
    });
    expect(health.bounce.rate).toBeCloseTo(0.06);
    expect(health.bounce.band).toBe("act");
  });

  it("ignores an unsubscribe or bounce from before the window", () => {
    const health = buildSendingHealth({
      recipients: [
        ...recipients(100),
        ...recipients(5, { sentAt: OLD, unsubscribedAt: OLD }),
      ],
      suppressions: suppressions(5, { createdAt: OLD }),
      since: SINCE,
    });
    expect(health.delivered).toBe(100);
    expect(health.unsubscribe.numerator).toBe(0);
    expect(health.bounce.numerator).toBe(0);
  });

  it("stays quiet when the sample is too small to mean anything", () => {
    // Two opt-outs from ten sends is 20%, which would scream — but ten
    // sends says nothing, and a false alarm here trains people to
    // ignore the real one.
    const health = buildSendingHealth({
      recipients: [...recipients(8), ...recipients(2, { unsubscribedAt: NOW })],
      suppressions: [],
      since: SINCE,
    });
    expect(health.unsubscribe.rate).toBeCloseTo(0.2);
    expect(health.unsubscribe.band).toBe("good");
    expect(health.overall).toBe("good");
  });

  it("has no rate at all before anything has been sent", () => {
    const health = buildSendingHealth({
      recipients: [],
      suppressions: [],
      since: SINCE,
    });
    expect(health.unsubscribe.rate).toBeNull();
    expect(health.bounce.rate).toBeNull();
    expect(health.overall).toBe("good");
  });
});

describe("describeBand", () => {
  it("says so plainly when there is not enough data", () => {
    expect(describeBand("good", "unsubscribe", 10)).toMatch(/Not enough sends/);
  });

  it("gives an action, not a label", () => {
    expect(describeBand("act", "bounce", 500)).toMatch(/needs cleaning/);
    expect(describeBand("act", "unsubscribe", 500)).toMatch(/who the last sends went to/);
  });
});

import { describe, it, expect } from "vitest";
import {
  MAX_ATTEMPTS,
  describeAttempt,
  isDelivered,
  nextAttemptAt,
  shouldRetry,
} from "./retry";

const NOW = new Date("2026-06-01T02:00:00Z");

describe("nextAttemptAt", () => {
  it("schedules further out each time", () => {
    const delays = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => {
      const at = nextAttemptAt(i + 1, NOW)!;
      return at.getTime() - NOW.getTime();
    });
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("stops after the last attempt", () => {
    expect(nextAttemptAt(MAX_ATTEMPTS, NOW)).toBeNull();
    expect(nextAttemptAt(MAX_ATTEMPTS + 5, NOW)).toBeNull();
  });

  it("rejects a nonsensical attempt number", () => {
    expect(nextAttemptAt(0, NOW)).toBeNull();
    expect(nextAttemptAt(-1, NOW)).toBeNull();
  });

  it("jitters, so an outage does not produce a thundering herd", () => {
    // Two hundred deliveries failing at once must not all retry in the
    // same second and knock the receiver over again.
    const times = new Set(
      Array.from({ length: 50 }, () => nextAttemptAt(3, NOW)!.getTime()),
    );
    expect(times.size).toBeGreaterThan(10);
  });

  it("never schedules in the past, however the jitter falls", () => {
    for (let i = 0; i < 200; i++) {
      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
        expect(nextAttemptAt(attempt, NOW)!.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it("spans about a day across all attempts", () => {
    const last = nextAttemptAt(MAX_ATTEMPTS - 1, NOW)!;
    const hours = (last.getTime() - NOW.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(5);
    expect(hours).toBeLessThan(13);
  });
});

describe("shouldRetry", () => {
  it("retries a network failure", () => {
    expect(shouldRetry(null)).toBe(true);
  });

  it("retries a server error", () => {
    expect(shouldRetry(500)).toBe(true);
    expect(shouldRetry(502)).toBe(true);
    expect(shouldRetry(503)).toBe(true);
  });

  it("gives up on a client error, which repeating cannot fix", () => {
    expect(shouldRetry(400)).toBe(false);
    expect(shouldRetry(401)).toBe(false);
    expect(shouldRetry(404)).toBe(false);
    expect(shouldRetry(410)).toBe(false);
  });

  it("retries the two 4xx that mean 'not now'", () => {
    expect(shouldRetry(408)).toBe(true);
    expect(shouldRetry(429)).toBe(true);
  });
});

describe("isDelivered", () => {
  it("accepts any 2xx", () => {
    expect(isDelivered(200)).toBe(true);
    expect(isDelivered(202)).toBe(true);
    expect(isDelivered(204)).toBe(true);
  });

  it("does not treat a redirect as delivered", () => {
    // The sender never follows redirects — an allowed host that 302s
    // to 127.0.0.1 would walk straight past the SSRF guard.
    expect(isDelivered(301)).toBe(false);
    expect(isDelivered(302)).toBe(false);
    expect(isDelivered(307)).toBe(false);
  });
});

describe("describeAttempt", () => {
  it("names the status when there was one", () => {
    expect(describeAttempt({ attempt: 2, status: 500, error: null })).toBe(
      "Attempt 2 — HTTP 500",
    );
  });

  it("falls back to the error when there was no response", () => {
    expect(
      describeAttempt({ attempt: 1, status: null, error: "Timed out after 10s" }),
    ).toBe("Attempt 1 — Timed out after 10s");
  });

  it("copes with neither", () => {
    expect(describeAttempt({ attempt: 1, status: null, error: null })).toMatch(
      /no response/,
    );
  });
});

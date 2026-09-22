import { describe, it, expect } from "vitest";
import {
  REPLAY_WINDOW_SECONDS,
  generateSecret,
  signPayload,
  verifySignature,
} from "./signature";

const SECRET = "whsec_test_secret_value";
const BODY = '{"event":"contact.unsubscribed","data":{"email":"a@b.com"}}';
const NOW = 1_790_000_000;

describe("signPayload", () => {
  it("is stable for the same input", () => {
    const a = signPayload({ body: BODY, timestamp: NOW, secret: SECRET });
    const b = signPayload({ body: BODY, timestamp: NOW, secret: SECRET });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("changes when the body changes", () => {
    const a = signPayload({ body: BODY, timestamp: NOW, secret: SECRET });
    const b = signPayload({ body: BODY + " ", timestamp: NOW, secret: SECRET });
    expect(a).not.toBe(b);
  });

  it("changes when the timestamp changes", () => {
    // This is what stops a captured delivery being replayed forever:
    // the signature is only valid for the moment it was made.
    const a = signPayload({ body: BODY, timestamp: NOW, secret: SECRET });
    const b = signPayload({ body: BODY, timestamp: NOW + 1, secret: SECRET });
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", () => {
    const a = signPayload({ body: BODY, timestamp: NOW, secret: SECRET });
    const b = signPayload({ body: BODY, timestamp: NOW, secret: "other" });
    expect(a).not.toBe(b);
  });
});

describe("verifySignature", () => {
  const sign = (over: { body?: string; timestamp?: number } = {}) =>
    signPayload({
      body: over.body ?? BODY,
      timestamp: over.timestamp ?? NOW,
      secret: SECRET,
    });

  it("accepts a delivery we just signed", () => {
    expect(
      verifySignature({
        body: BODY,
        timestamp: NOW,
        signature: sign(),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const v = verifySignature({
      body: '{"event":"contact.unsubscribed","data":{"email":"attacker@b.com"}}',
      timestamp: NOW,
      signature: sign(),
      secret: SECRET,
      now: NOW,
    });
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects the wrong secret", () => {
    const v = verifySignature({
      body: BODY,
      timestamp: NOW,
      signature: sign(),
      secret: "not-the-secret",
      now: NOW,
    });
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a replay from outside the window", () => {
    const v = verifySignature({
      body: BODY,
      timestamp: NOW,
      signature: sign(),
      secret: SECRET,
      now: NOW + REPLAY_WINDOW_SECONDS + 1,
    });
    expect(v).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts one right at the edge of the window", () => {
    const v = verifySignature({
      body: BODY,
      timestamp: NOW,
      signature: sign(),
      secret: SECRET,
      now: NOW + REPLAY_WINDOW_SECONDS,
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a delivery timestamped in the future", () => {
    // Skew forward is as suspicious as skew backward — it is how a
    // captured delivery would be made to last longer.
    const v = verifySignature({
      body: BODY,
      timestamp: NOW + REPLAY_WINDOW_SECONDS + 60,
      signature: sign({ timestamp: NOW + REPLAY_WINDOW_SECONDS + 60 }),
      secret: SECRET,
      now: NOW,
    });
    expect(v).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a malformed signature rather than throwing", () => {
    for (const signature of ["", "deadbeef", "md5=abc", "sha256"]) {
      const v = verifySignature({
        body: BODY,
        timestamp: NOW,
        signature,
        secret: SECRET,
        now: NOW,
      });
      expect(v.ok, signature).toBe(false);
    }
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on unequal lengths, so the comparison has
    // to check that first.
    const v = verifySignature({
      body: BODY,
      timestamp: NOW,
      signature: "sha256=abc",
      secret: SECRET,
      now: NOW,
    });
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a non-finite timestamp", () => {
    const v = verifySignature({
      body: BODY,
      timestamp: NaN,
      signature: sign(),
      secret: SECRET,
      now: NOW,
    });
    expect(v).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("generateSecret", () => {
  it("is prefixed, long, and different every time", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import {
  buildRecipientLinks,
  issueTrackingToken,
  safeRedirectTarget,
  verifyTrackingToken,
} from "./tracking";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-campaign-tracking";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

describe("tracking tokens", () => {
  it("round-trips the campaign and recipient", async () => {
    const token = await issueTrackingToken({
      cid: "camp-1",
      em: "Sarah@Example.com",
      p: "unsubscribe",
    });
    const result = await verifyTrackingToken(token, "unsubscribe");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.cid).toBe("camp-1");
    // Lower-cased at issue time so it matches the suppression key.
    expect(result.claims.em).toBe("sarah@example.com");
  });

  it("refuses a token minted for a different purpose", async () => {
    const token = await issueTrackingToken({
      cid: "camp-1",
      em: "sarah@example.com",
      p: "open",
    });
    const result = await verifyTrackingToken(token, "unsubscribe");
    expect(result).toEqual({ ok: false, reason: "wrong-purpose" });
  });

  it("refuses a tampered token", async () => {
    const token = await issueTrackingToken({
      cid: "camp-1",
      em: "sarah@example.com",
      p: "unsubscribe",
    });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ cid: "camp-1", em: "someone-else@example.com", p: "unsubscribe" }),
    ).toString("base64url");
    const result = await verifyTrackingToken(
      `${header}.${forged}.${signature}`,
      "unsubscribe",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("buildRecipientLinks", () => {
  it("always issues an unsubscribe link", async () => {
    const links = await buildRecipientLinks({
      campaignId: "camp-1",
      email: "sarah@example.com",
      trackOpens: false,
      trackClicks: false,
    });
    expect(links.unsubscribeUrl).toMatch(/^https:\/\/app\.example\.com\/e\/u\//);
    expect(links.openPixelUrl).toBeUndefined();
    expect(links.wrapUrl).toBeUndefined();
  });

  it("adds the pixel and the click wrapper when tracking is on", async () => {
    const links = await buildRecipientLinks({
      campaignId: "camp-1",
      email: "sarah@example.com",
      trackOpens: true,
      trackClicks: true,
    });
    expect(links.openPixelUrl).toMatch(/\/e\/o\//);
    const wrapped = links.wrapUrl!("https://mankinfinance.com/rates?a=1&b=2");
    expect(wrapped).toContain("/e/c/");
    expect(wrapped).toContain("u=https%3A%2F%2Fmankinfinance.com%2Frates%3Fa%3D1%26b%3D2");
  });
});

describe("safeRedirectTarget", () => {
  it("passes ordinary web addresses through", () => {
    expect(safeRedirectTarget("https://mankinfinance.com/rates")).toBe(
      "https://mankinfinance.com/rates",
    );
  });

  it("refuses anything that isn't http(s)", () => {
    expect(safeRedirectTarget("javascript:alert(1)")).toBeNull();
    expect(safeRedirectTarget("data:text/html,<script>")).toBeNull();
    expect(safeRedirectTarget("/relative/path")).toBeNull();
    expect(safeRedirectTarget(null)).toBeNull();
  });
});

describe("click redirect trust boundary", () => {
  /* The route forwards to `?u=` only when the token is authentic. These
     assert the property the route relies on: a verifier result tells
     an expired-but-genuine token apart from a forged one, so the route
     can honour the first and refuse the second. */

  it("reports a forged token as invalid, not expired", async () => {
    const forged = await new SignJWT({ cid: "c1", em: "a@b.com", p: "click" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("mankin-followup")
      .setAudience("campaign")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-the-real-secret"));

    const result = await verifyTrackingToken(forged, "click");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
  });

  it("reports nonsense as invalid", async () => {
    const result = await verifyTrackingToken("not-a-token", "click");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
  });

  it("reports a genuine expired token as expired", async () => {
    // jose verifies the signature before it looks at exp, so "expired"
    // is only ever reachable for a token we really issued — which is
    // what lets the route still forward an old link.
    const stale = await new SignJWT({ cid: "c1", em: "a@b.com", p: "click" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("mankin-followup")
      .setAudience("campaign")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));

    const result = await verifyTrackingToken(stale, "click");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });
});

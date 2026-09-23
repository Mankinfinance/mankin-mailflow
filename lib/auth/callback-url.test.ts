import { describe, it, expect } from "vitest";
import { safeCallbackPath, DEFAULT_SIGNED_IN_PATH } from "./callback-url";

const ORIGIN = "https://mankin-mailflow.vercel.app";

describe("safeCallbackPath", () => {
  it("keeps a rooted same-site path", () => {
    expect(safeCallbackPath("/marketing/settings/database")).toBe(
      "/marketing/settings/database",
    );
  });

  it("keeps the query and hash", () => {
    expect(safeCallbackPath("/marketing/campaigns?status=sent#top")).toBe(
      "/marketing/campaigns?status=sent#top",
    );
  });

  it("falls back when there is nothing to go on", () => {
    expect(safeCallbackPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeCallbackPath("")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeCallbackPath("   ")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("reduces an absolute URL on our own origin to its path", () => {
    expect(
      safeCallbackPath(`${ORIGIN}/marketing/surveys`, ORIGIN),
    ).toBe("/marketing/surveys");
  });

  it("refuses an absolute URL on someone else's origin", () => {
    expect(
      safeCallbackPath("https://evil.example.com/marketing", ORIGIN),
    ).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses an absolute URL when we do not know our own origin", () => {
    expect(safeCallbackPath(`${ORIGIN}/marketing`)).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("refuses a protocol-relative URL", () => {
    // The one that looks like a path and is not.
    expect(safeCallbackPath("//evil.example.com/marketing")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
    expect(safeCallbackPath("/\\evil.example.com")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("refuses a backslash anywhere", () => {
    expect(safeCallbackPath("/marketing\\..\\evil")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("refuses a non-http scheme", () => {
    expect(safeCallbackPath("javascript:alert(1)")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
    expect(safeCallbackPath("mailto:someone@example.com")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("refuses a bare hostname", () => {
    expect(safeCallbackPath("evil.example.com")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("does not send anyone back to the sign-in page", () => {
    expect(safeCallbackPath("/login")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeCallbackPath("/login?error=OAuthSignin")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("refuses a malformed absolute URL rather than throwing", () => {
    expect(safeCallbackPath("https://", ORIGIN)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

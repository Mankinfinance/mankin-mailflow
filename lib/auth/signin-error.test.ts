import { describe, it, expect } from "vitest";
import { describeSignInError } from "./signin-error";

describe("describeSignInError", () => {
  it("says nothing when there is no error", () => {
    // A first visit must not show a scary red panel.
    expect(describeSignInError(undefined)).toBeNull();
    expect(describeSignInError("")).toBeNull();
  });

  it("points a callback failure at the client secret", () => {
    // The overwhelmingly common cause, and the one where the fix is
    // non-obvious: Secret ID copied instead of Value.
    const p = describeSignInError("OAuthCallbackError")!;
    expect(p.detail).toMatch(/client secret/i);
    expect(p.detail).toMatch(/Value/);
    expect(p.detail).toMatch(/AUTH_MICROSOFT_ENTRA_ID_SECRET/);
  });

  it("points a start failure at the issuer and id", () => {
    const p = describeSignInError("OAuthSignin")!;
    expect(p.detail).toMatch(/ISSUER/);
  });

  it("explains a missing AUTH_SECRET", () => {
    const p = describeSignInError("Configuration")!;
    expect(p.detail).toMatch(/AUTH_SECRET/);
    expect(p.detail).toMatch(/redeploy/i);
  });

  it("does not blame the user for a rejected account", () => {
    const p = describeSignInError("AccessDenied")!;
    expect(p.headline).toMatch(/not allowed/i);
  });

  it("still says something useful for a code it does not know", () => {
    // A code with no case must not render an empty panel.
    const p = describeSignInError("SomethingNewInAuthJs")!;
    expect(p.headline.length).toBeGreaterThan(0);
    expect(p.detail.length).toBeGreaterThan(0);
    expect(p.code).toBe("SomethingNewInAuthJs");
  });

  it("always carries the raw code, which is what a search needs", () => {
    for (const code of ["OAuthCallbackError", "Configuration", "Whatever"]) {
      expect(describeSignInError(code)!.code).toBe(code);
    }
  });
});

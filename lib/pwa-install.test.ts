import { describe, it, expect, vi, afterEach } from "vitest";
import { markInstalled, platform, promptInstall, rememberInstallPrompt, type InstallEvent } from "./pwa-install";

const ua = (value: string, touch = 0) => {
  vi.stubGlobal("navigator", { userAgent: value, maxTouchPoints: touch });
};

afterEach(() => {
  vi.unstubAllGlobals();
  rememberInstallPrompt(null);
});

describe("platform", () => {
  it("knows an iPhone, and an iPad that reports itself as a Mac", () => {
    ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1");
    expect(platform()).toBe("ios");
    ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/18.0 Safari/605.1.15", 5);
    expect(platform()).toBe("ios");
  });

  it("tells Safari on a Mac from Chrome and Edge, which have their own install button", () => {
    ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/18.0 Safari/605.1.15");
    expect(platform()).toBe("mac-safari");
    ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Chrome/131.0 Safari/537.36");
    expect(platform()).toBe("other");
    ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/131.0 Safari/537.36 Edg/131.0");
    expect(platform()).toBe("other");
  });
});

describe("promptInstall", () => {
  it("says so when the browser has no dialog to show", async () => {
    expect(await promptInstall()).toBe(false);
  });

  it("shows the browser's dialog once, then forgets it", async () => {
    const prompt = vi.fn(async () => {});
    rememberInstallPrompt({ prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) } as unknown as InstallEvent);
    expect(await promptInstall()).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    // A browser offer can only be used once.
    expect(await promptInstall()).toBe(false);
  });

  it("stops offering once installed", async () => {
    markInstalled();
    expect(await promptInstall()).toBe(false);
  });
});

describe("isStandalone", () => {
  it("counts the Android and iPhone app as installed, so it never offers to install itself", async () => {
    const { isStandalone, isNativeApp } = await import("./pwa-install");
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/131.0 Mobile Safari/537.36 MailflowApp/1.0",
    });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isNativeApp()).toBe(true);
    expect(isStandalone()).toBe(true);
  });

  it("does not mistake a browser tab for the app", async () => {
    const { isStandalone, isNativeApp } = await import("./pwa-install");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isNativeApp()).toBe(false);
    expect(isStandalone()).toBe(false);
  });
});

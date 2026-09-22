import { describe, it, expect } from "vitest";
import { checkWebhookUrl, isPrivateAddress } from "./safe-url";

describe("isPrivateAddress — the ranges that turn this into an SSRF", () => {
  it("blocks the cloud metadata address", () => {
    // The first thing anyone tries. 169.254.169.254 serves instance
    // credentials on most clouds.
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  it("blocks loopback in every shape", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("127.1.2.3")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    // The same host wearing a hex coat.
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
  });

  it("blocks the RFC 1918 ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.254")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  it("does not over-block the neighbours of 172.16/12", () => {
    // 172.15 and 172.32 are public. Blocking all of 172/8 would refuse
    // real receivers.
    expect(isPrivateAddress("172.15.0.1")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
  });

  it("blocks carrier-grade NAT, benchmarking and multicast", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("255.255.255.255")).toBe(true);
  });

  it("blocks 0.0.0.0, which routes to localhost on Linux", () => {
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  it("blocks IPv6 link-local and unique-local", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateAddress("ff02::1")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("treats anything unparseable as unsafe rather than safe", () => {
    // Fail closed: a string we cannot reason about is not a string we
    // should let the server connect to.
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("checkWebhookUrl", () => {
  it("refuses plaintext HTTP", async () => {
    const v = await checkWebhookUrl("http://example.com/hook");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/HTTPS/);
  });

  it("refuses a literal private address without touching DNS", async () => {
    for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "[::1]"]) {
      const v = await checkWebhookUrl(`https://${host}/hook`);
      expect(v.ok, host).toBe(false);
    }
  });

  it("refuses localhost and internal-looking names", async () => {
    for (const host of ["localhost", "api.localhost", "db.internal", "nas.local"]) {
      const v = await checkWebhookUrl(`https://${host}/hook`);
      expect(v.ok, host).toBe(false);
    }
  });

  it("refuses credentials embedded in the URL", async () => {
    const v = await checkWebhookUrl("https://user:pass@example.com/hook");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/credentials/i);
  });

  it("refuses a non-standard port", async () => {
    // Usually someone probing an internal service rather than a real
    // receiver.
    const v = await checkWebhookUrl("https://example.com:8080/hook");
    expect(v.ok).toBe(false);
  });

  it("accepts an explicit :443", async () => {
    const v = await checkWebhookUrl("https://example.com:443/hook");
    expect(v.ok).toBe(true);
  });

  it("refuses something that is not a URL at all", async () => {
    expect((await checkWebhookUrl("hook me up")).ok).toBe(false);
    expect((await checkWebhookUrl("")).ok).toBe(false);
  });

  it("refuses a hostname that does not resolve", async () => {
    const v = await checkWebhookUrl(
      "https://this-name-should-not-exist-mailflow-test.invalid/hook",
    );
    expect(v.ok).toBe(false);
  });

  it("accepts a public receiver and returns the normalised URL", async () => {
    const v = await checkWebhookUrl("  https://example.com/hooks/mailflow  ");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.url).toBe("https://example.com/hooks/mailflow");
  });
});

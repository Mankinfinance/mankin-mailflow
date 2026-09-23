import { describe, it, expect } from "vitest";
import { evaluateSenderAuth, type SenderRecords } from "./sender-auth";

/** Mankin Finance's records as they stood when this was written. */
const today: SenderRecords = {
  domain: "mankinfinance.com",
  txt: [
    "v=spf1 include:_spf.mlsend.com include:spf.protection.outlook.com -all",
    "mailerlite-domain-verification=39fa",
  ],
  dmarc: ["v=DMARC1; p=none; rua=mailto:michael@mankinfinance.com"],
  selector1: "none",
  selector2: "none",
  appUrl: "https://mankin-mailflow.vercel.app",
};

const done: SenderRecords = {
  ...today,
  dmarc: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@mankinfinance.com"],
  selector1: "selector1-mankinfinance-com._domainkey.mankin.r-v1.dkim.mail.microsoft",
  selector2: "selector2-mankinfinance-com._domainkey.mankin.r-v1.dkim.mail.microsoft",
  appUrl: "https://mail.mankinfinance.com",
};

const status = (r: SenderRecords, key: string) =>
  evaluateSenderAuth(r).checks.find((c) => c.key === key)?.status;

describe("evaluateSenderAuth", () => {
  it("does not call today's setup authenticated, because DKIM is off", () => {
    const result = evaluateSenderAuth(today);
    expect(result.authenticated).toBe(false);
    expect(status(today, "spf")).toBe("pass");
    expect(status(today, "dkim")).toBe("fail");
    expect(status(today, "dmarc")).toBe("warn");
    expect(status(today, "links")).toBe("warn");
  });

  it("tells the person where DKIM is switched on", () => {
    const dkim = evaluateSenderAuth(today).checks.find((c) => c.key === "dkim");
    expect(dkim?.fix).toContain("security.microsoft.com");
    expect(dkim?.fix).toContain("selector1");
  });

  it("passes everything once DKIM, DMARC and the link domain are done", () => {
    const result = evaluateSenderAuth(done);
    expect(result.authenticated).toBe(true);
    expect(result.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("calls it authenticated on p=none, which is still only a warning", () => {
    const r = { ...done, dmarc: today.dmarc };
    expect(evaluateSenderAuth(r).authenticated).toBe(true);
    expect(status(r, "dmarc")).toBe("warn");
  });

  it("fails SPF that leaves out Microsoft 365", () => {
    expect(status({ ...done, txt: ["v=spf1 include:_spf.mlsend.com -all"] }, "spf")).toBe("fail");
  });

  it("fails two SPF records, which receivers treat as none", () => {
    expect(
      status(
        {
          ...done,
          txt: [
            "v=spf1 include:spf.protection.outlook.com -all",
            "v=spf1 include:_spf.mlsend.com -all",
          ],
        },
        "spf",
      ),
    ).toBe("fail");
  });

  it("warns on an SPF record that ends +all or has no all", () => {
    expect(status({ ...done, txt: ["v=spf1 include:spf.protection.outlook.com +all"] }, "spf")).toBe("warn");
    expect(status({ ...done, txt: ["v=spf1 include:spf.protection.outlook.com"] }, "spf")).toBe("warn");
  });

  it("fails a missing SPF or DMARC record", () => {
    expect(status({ ...done, txt: "none" }, "spf")).toBe("fail");
    expect(status({ ...done, dmarc: "none" }, "dmarc")).toBe("fail");
    expect(evaluateSenderAuth({ ...done, dmarc: "none" }).authenticated).toBe(false);
  });

  it("needs both DKIM selectors, since Microsoft rotates between them", () => {
    expect(status({ ...done, selector2: "none" }, "dkim")).toBe("fail");
  });

  it("says unknown rather than fail when DNS cannot be reached", () => {
    const r = { ...done, txt: "error" as const, selector1: "error" as const };
    expect(status(r, "spf")).toBe("unknown");
    expect(status(r, "dkim")).toBe("unknown");
    expect(evaluateSenderAuth(r).authenticated).toBe(false);
  });

  it("accepts links on the firm's .com.au as its own domain", () => {
    expect(status({ ...done, appUrl: "https://go.mankinfinance.com.au" }, "links")).toBe("pass");
  });

  it("warns on links to an unrelated domain, and fails with no app URL", () => {
    expect(status({ ...done, appUrl: "https://example.org" }, "links")).toBe("warn");
    expect(status({ ...done, appUrl: undefined }, "links")).toBe("fail");
    expect(status({ ...done, appUrl: "http://localhost:3000" }, "links")).toBe("fail");
  });
});

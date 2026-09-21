import { describe, expect, it } from "vitest";
import { normaliseAuPhone } from "./sms-broadcast";

describe("normaliseAuPhone", () => {
  it("normalises a spaced AU mobile to international form", () => {
    expect(normaliseAuPhone("0411 234 567")).toBe("61411234567");
  });

  it("normalises a compact local form", () => {
    expect(normaliseAuPhone("0411234567")).toBe("61411234567");
  });

  it("passes through international format with country code", () => {
    expect(normaliseAuPhone("61411234567")).toBe("61411234567");
  });

  it("normalises +61 prefix to no-plus international", () => {
    expect(normaliseAuPhone("+61 411 234 567")).toBe("61411234567");
  });

  it("normalises 9-digit form (sometimes from Salestrekker)", () => {
    expect(normaliseAuPhone("411234567")).toBe("61411234567");
  });

  it("strips punctuation", () => {
    expect(normaliseAuPhone("(0411) 234-567")).toBe("61411234567");
  });

  it("returns null on empty string", () => {
    expect(normaliseAuPhone("")).toBeNull();
  });

  it("returns null on landline (doesn't start with 04)", () => {
    expect(normaliseAuPhone("02 1234 5678")).toBeNull();
  });

  it("returns null on too-short input", () => {
    expect(normaliseAuPhone("0411")).toBeNull();
  });
});

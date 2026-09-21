import { describe, it, expect } from "vitest";
import { checkContent, contentVerdict } from "./spam-check";

const GOOD = {
  subject: "Sarah, your ANZ loan turns one this month",
  body: [
    "Hi Sarah,",
    "",
    "Your ANZ loan settled a year ago, which makes now a sensible time to check it is still the right one for you.",
    "",
    "A review covers whether your rate is still competitive, what your balance would cost at today's pricing, and whether your circumstances have changed enough to restructure.",
    "",
    "[Book a 15-minute review](https://tidycal.com/example)",
    "",
    "Michael Mankin",
  ].join("\n"),
};

function messages(input: { subject: string; body: string }): string {
  return checkContent(input)
    .map((i) => i.message)
    .join(" | ");
}

describe("checkContent", () => {
  it("passes a well-written broker email clean", () => {
    expect(checkContent(GOOD)).toEqual([]);
    expect(contentVerdict([])).toBe("clean");
  });

  it("catches a shouted subject", () => {
    expect(messages({ ...GOOD, subject: "URGENT RATE UPDATE INSIDE" })).toMatch(
      /in capitals/,
    );
  });

  it("catches piled-up punctuation", () => {
    expect(messages({ ...GOOD, subject: "Big news!!" })).toMatch(/exclamation/);
    expect(messages({ ...GOOD, subject: "Really? Are you sure?!" })).toMatch(
      /exclamation/,
    );
  });

  it("names the phrases filters weight, and escalates when there are several", () => {
    const issues = checkContent({
      subject: "Act now for guaranteed approval",
      body: `${GOOD.body}\n\nThis is a limited time offer, click here for your free quote.`,
    });
    const phraseIssue = issues.find((i) => i.message.startsWith("Phrases"))!;
    expect(phraseIssue.message).toContain("act now");
    expect(phraseIssue.severity).toBe("warn");
  });

  it("treats one stray phrase as a note, not a warning", () => {
    const issues = checkContent({
      ...GOOD,
      body: `${GOOD.body}\n\nThere is no obligation either way.`,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("note");
    expect(contentVerdict(issues)).toBe("notes");
  });

  it("flags a shortened link", () => {
    expect(
      messages({ ...GOOD, body: `${GOOD.body}\n\nMore: https://bit.ly/abc123` }),
    ).toMatch(/shortened link/);
  });

  it("flags a wall of links", () => {
    // The good body already carries one, so six more makes seven.
    const links = Array.from(
      { length: 6 },
      (_, i) => `[Link ${i}](https://mankinfinance.com/${i})`,
    ).join("\n");
    expect(messages({ ...GOOD, body: `${GOOD.body}\n${links}` })).toMatch(
      /7 links/,
    );
  });

  it("leaves a normal two-link email alone", () => {
    const issues = checkContent({
      ...GOOD,
      body: `${GOOD.body}\n\n[Our rates](https://mankinfinance.com/rates)`,
    });
    expect(issues).toEqual([]);
  });

  it("does not count a merge field as an off-domain link", () => {
    // {{booking_url}} resolves to the broker's own calendar at send time.
    const issues = checkContent({
      ...GOOD,
      body: GOOD.body.replace(
        "https://tidycal.com/example",
        "{{booking_url}}",
      ),
    });
    expect(issues).toEqual([]);
  });

  it("flags a body that is barely more than a link", () => {
    expect(
      messages({ subject: "Have a look", body: "[Click](https://mankinfinance.com)" }),
    ).toMatch(/only \d+ words/);
  });

  it("flags a missing subject or body outright", () => {
    expect(messages({ subject: "", body: GOOD.body })).toMatch(/no subject/);
    expect(messages({ subject: "Hello", body: "" })).toMatch(/no body/);
  });

  it("notes a subject that will be cut off on a phone", () => {
    const long = "Your annual home loan review is due and here is everything we will cover";
    expect(messages({ ...GOOD, subject: long })).toMatch(/characters/);
  });

  it("gives every issue something to do about it", () => {
    const issues = checkContent({
      subject: "ACT NOW!! GUARANTEED APPROVAL",
      body: "Click here: https://bit.ly/x",
    });
    expect(issues.length).toBeGreaterThan(3);
    for (const issue of issues) {
      expect(issue.fix.length).toBeGreaterThan(10);
    }
  });
});

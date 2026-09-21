import { describe, it, expect } from "vitest";
import {
  applyMergeFields,
  renderCampaign,
  unknownMergeFields,
  unsubscribeFooterHtml,
} from "./merge";
import { MERGE_FIELDS } from "./audience";

const FIELDS = {
  first_name: "Sarah",
  full_name: "Sarah Chen",
  lender: "ANZ",
  loan_amount: "$640,000",
  booking_url: "https://tidycal.com/example",
};

const LINKS = { unsubscribeUrl: "https://app.example.com/e/u/tok" };

describe("applyMergeFields", () => {
  it("substitutes fields, tolerating whitespace and case in the token", () => {
    expect(applyMergeFields("Hi {{first_name}} and {{ FIRST_NAME }}", FIELDS)).toBe(
      "Hi Sarah and Sarah",
    );
  });

  it("collapses an unknown field rather than leaking the raw token", () => {
    expect(applyMergeFields("Hi {{nickname}}!", FIELDS)).toBe("Hi !");
  });
});

describe("unknownMergeFields", () => {
  it("catches a typo against the known field list", () => {
    expect(unknownMergeFields("Hi {{firstname}}, your {{lender}}", MERGE_FIELDS)).toEqual([
      "firstname",
    ]);
  });

  it("is quiet when every field is real", () => {
    expect(unknownMergeFields("Hi {{first_name}}", MERGE_FIELDS)).toEqual([]);
  });
});

describe("renderCampaign", () => {
  it("merges the subject and body", () => {
    const out = renderCampaign({
      subject: "{{first_name}}, a quick rate update",
      body: "Hi {{first_name}},\n\nYour {{lender}} loan is worth another look.",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.subject).toBe("Sarah, a quick rate update");
    expect(out.html).toContain("Hi Sarah,");
    expect(out.html).toContain("ANZ");
  });

  it("renders a markdown link as a real anchor", () => {
    const out = renderCampaign({
      subject: "s",
      body: "Grab a time: [Book a chat](https://tidycal.com/example)",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.html).toContain('<a href="https://tidycal.com/example"');
    expect(out.html).toContain(">Book a chat</a>");
    // The placeholder must never survive into the customer's inbox.
    expect(out.html).not.toContain("MFLINK");
    expect(out.text).not.toContain("MFLINK");
  });

  it("wraps links for click tracking when asked, leaving the label alone", () => {
    const out = renderCampaign({
      subject: "s",
      body: "[Book a chat](https://tidycal.com/example)",
      fields: FIELDS,
      brokerId: "mm",
      links: { ...LINKS, wrapUrl: (url) => `https://app.example.com/e/c/tok?u=${encodeURIComponent(url)}` },
    });
    expect(out.html).toContain("/e/c/tok?u=https%3A%2F%2Ftidycal.com%2Fexample");
    expect(out.html).toContain(">Book a chat</a>");
  });

  it("gives plain-text readers the address, not just the label", () => {
    const out = renderCampaign({
      subject: "s",
      body: "[Book a chat](https://tidycal.com/example)",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.text).toContain("Book a chat: https://tidycal.com/example");
  });

  it("escapes HTML that arrives through a merge value", () => {
    const out = renderCampaign({
      subject: "s",
      body: "Hi {{first_name}}",
      fields: { first_name: "<script>alert(1)</script>" },
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("always carries the unsubscribe link in both formats", () => {
    const out = renderCampaign({
      subject: "s",
      body: "Body",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.html).toContain(LINKS.unsubscribeUrl);
    expect(out.html).toContain("Unsubscribe");
    expect(out.text).toContain(LINKS.unsubscribeUrl);
  });

  it("adds the open pixel only when tracking is on", () => {
    const withPixel = renderCampaign({
      subject: "s",
      body: "Body",
      fields: FIELDS,
      brokerId: "mm",
      links: { ...LINKS, openPixelUrl: "https://app.example.com/e/o/tok" },
    });
    expect(withPixel.html).toContain('<img src="https://app.example.com/e/o/tok"');

    const withoutPixel = renderCampaign({
      subject: "s",
      body: "Body",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(withoutPixel.html).not.toContain("<img");
  });

  it("appends the broker signature, since nobody is in Outlook to insert one", () => {
    const out = renderCampaign({
      subject: "s",
      body: "Body",
      fields: FIELDS,
      brokerId: "mm",
      links: LINKS,
    });
    expect(out.html).toContain("Michael Mankin");
    expect(out.text).toContain("Michael Mankin");
  });
});

describe("unsubscribeFooterHtml", () => {
  it("omits the postal line when none is configured", () => {
    const html = unsubscribeFooterHtml("https://app.example.com/e/u/tok");
    expect(html).not.toContain("Mankin Finance Pty Ltd,");
  });
});

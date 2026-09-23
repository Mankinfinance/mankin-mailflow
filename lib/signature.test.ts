import { describe, it, expect } from "vitest";
import { signatureFor, MANKIN_LICENCE_LINES } from "./email-signature";
import { SignatureSchema, type SignatureSettings } from "./mailflow/settings";
import { renderCampaign } from "./campaigns/merge";
import { imageUrlFrom } from "@/components/mailflow/SignatureForm";

const ADDRESS = "Suite 208, Oran Park Podium, 351 Oran Park Drive, Oran Park NSW 2570";

function sig(over: Partial<SignatureSettings> = {}): SignatureSettings {
  return { ...SignatureSchema.parse({}), ...over };
}

const full = sig({
  instagramUrl: "https://www.instagram.com/mankinfinance",
  instagramIconUrl: "https://files.example.com/ig.png",
  linkedinUrl: "https://www.linkedin.com/company/mankin-finance",
  awards: [
    { imageUrl: "https://files.example.com/abs-2024.png", alt: "Winner, Australian Broking Awards 2024, Rising Star" },
    { imageUrl: "", alt: "Left blank, so not shown" },
  ],
  brokers: { mm: { title: "Director / Finance Broker", photoUrl: "https://files.example.com/michael.png" } },
});

describe("the signature", () => {
  it("follows the firm's layout for Michael", () => {
    const { html } = signatureFor("mm", { signature: full, postalAddress: ADDRESS });
    const order = [
      "Regards",
      "<strong>Michael Mankin</strong> | Director / Finance Broker | Mankin Finance",
      'alt="Michael Mankin"',
      "0420 699 983",
      "michael@mankinfinance.com",
      "www.mankinfinance.com.au",
      'alt="Instagram"',
      "Schedule a free 30 minute consultation",
      "Winner, Australian Broking Awards 2024, Rising Star",
      ADDRESS,
      "The content of this email is confidential",
      "Australian Credit Representative 102746",
    ];
    let at = -1;
    for (const piece of order) {
      const next = html.indexOf(piece, at + 1);
      expect(next, piece).toBeGreaterThan(at);
      at = next;
    }
  });

  it("always carries the licence lines, even with everything else emptied", () => {
    const bare = sig({ signOff: "", disclaimer: "", websiteUrl: "" });
    const { html, text } = signatureFor("na", { signature: bare });
    for (const line of MANKIN_LICENCE_LINES) {
      expect(html).toContain(line.split(" | ")[1] ?? line);
      expect(text).toContain(line);
    }
  });

  it("drops the photo column for someone without a photo", () => {
    const { html } = signatureFor("na", { signature: full, postalAddress: ADDRESS });
    expect(html).not.toContain('alt="Nathan Austin"');
    expect(html).toContain("Nathan Austin");
  });

  it("shows a social profile without an icon as a text link, and leaves out one with no profile", () => {
    const { html } = signatureFor("mm", { signature: full });
    expect(html).toContain('href="https://www.linkedin.com/company/mankin-finance"');
    expect(html).toContain(">LinkedIn</a>");
    const none = signatureFor("mm", { signature: sig() }).html;
    expect(none).not.toContain("Instagram");
    expect(none).not.toContain("LinkedIn");
  });

  it("gives the booking line only to a broker with a calendar", () => {
    expect(signatureFor("mm", { signature: full }).html).toContain("tidycal.com/3qr45gm");
    expect(signatureFor("na", { signature: full }).html).not.toContain("Schedule a free 30 minute consultation");
  });

  it("shows only badges that have an image", () => {
    const { html } = signatureFor("mm", { signature: full });
    expect(html).not.toContain("Left blank, so not shown");
  });

  it("uses the team role when no title is set", () => {
    expect(signatureFor("na", { signature: full }).html).toContain("| Finance Broker |");
  });

  it("leaves out the address band when there is no address", () => {
    expect(signatureFor("mm", { signature: full }).html).not.toContain('bgcolor="#0a0a64"');
  });

  it("escapes anything typed into a field", () => {
    const hostile = sig({ brokers: { mm: { title: '<img src=x onerror="alert(1)">', photoUrl: "" } } });
    const { html } = signatureFor("mm", { signature: hostile });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("writes a readable plain-text version", () => {
    const { text } = signatureFor("mm", { signature: full, postalAddress: ADDRESS });
    expect(text).toContain("Michael Mankin | Director / Finance Broker | Mankin Finance");
    expect(text).toContain("Instagram: https://www.instagram.com/mankinfinance");
    expect(text).toContain(ADDRESS);
  });
});

describe("signature settings", () => {
  it("refuse a plain-http image, which mail apps block", () => {
    expect(SignatureSchema.safeParse({ awards: [{ imageUrl: "http://x.example.com/a.png", alt: "" }] }).success).toBe(false);
  });

  it("refuse anything that is not a web address", () => {
    expect(SignatureSchema.safeParse({ websiteUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(SignatureSchema.safeParse({ instagramUrl: 'https://x.example.com/"onmouseover' }).success).toBe(false);
  });

  it("accept an https address or nothing", () => {
    expect(SignatureSchema.safeParse({ websiteUrl: "https://www.mankinfinance.com.au", instagramUrl: "" }).success).toBe(true);
  });

  it("default to the firm's own wording and website", () => {
    const d = SignatureSchema.parse({});
    expect(d.signOff).toBe("Regards");
    expect(d.websiteUrl).toBe("https://www.mankinfinance.com.au");
    expect(d.brokers.mm.title).toBe("Director / Finance Broker");
  });
});

describe("pasting from File manager", () => {
  it("takes the address out of a copied snippet", () => {
    expect(imageUrlFrom("![Rising Star](https://mankin-mailflow.vercel.app/api/files/abc)")).toBe(
      "https://mankin-mailflow.vercel.app/api/files/abc",
    );
  });

  it("leaves a plain address alone", () => {
    expect(imageUrlFrom(" https://x.example.com/a.png ")).toBe("https://x.example.com/a.png");
  });
});

describe("in a rendered email", () => {
  it("prints the address once, in the band, not again in the footer", () => {
    const out = renderCampaign({
      subject: "Hi",
      body: "Hi {{first_name}},\n\nWorth a look at your rate this year.",
      fields: { first_name: "Sarah" },
      brokerId: "mm",
      links: { unsubscribeUrl: "https://app.example.com/e/u/x" },
      postalAddress: ADDRESS,
      signature: full,
    });
    expect(out.html.split(ADDRESS).length - 1).toBe(1);
    expect(out.html).toContain("Unsubscribe");
  });
});

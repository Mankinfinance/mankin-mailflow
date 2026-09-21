import { describe, it, expect } from "vitest";
import { buildMimeMessage } from "./outlook-mime";

const BASE = {
  fromEmail: "michael@mankinfinance.com",
  fromName: "Michael Mankin",
  to: "sarah@example.com",
  subject: "Your ANZ rate is worth a look",
  html: "<p>Hello Sarah</p>",
  text: "Hello Sarah",
  unsubscribeUrl: "https://app.example.com/api/e/u/tok",
  unsubscribeMailto: "unsubscribe@mankinfinance.com",
};

function decodePart(mime: string, contentType: string): string {
  const section = mime
    .split(/--[-\w]*mankin-[0-9a-f-]+/)
    .find((s) => s.includes(contentType));
  if (!section) return "";
  const body = section.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("buildMimeMessage", () => {
  const mime = buildMimeMessage(BASE);

  it("carries the one-click unsubscribe pair Gmail and Yahoo require", () => {
    // Without these two headers together, bulk mail to Gmail is filtered
    // regardless of how good the content is.
    expect(mime).toContain(
      "List-Unsubscribe: <https://app.example.com/api/e/u/tok>, <mailto:unsubscribe@mankinfinance.com>",
    );
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("puts the https endpoint first, since that is what receives the POST", () => {
    const header = mime.split("\r\n").find((l) => l.startsWith("List-Unsubscribe:"))!;
    expect(header.indexOf("https://")).toBeLessThan(header.indexOf("mailto:"));
  });

  it("sends a real multipart/alternative, not HTML alone", () => {
    // HTML-only is one of the oldest reliable spam signals.
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(decodePart(mime, "text/plain")).toContain("Hello Sarah");
    expect(decodePart(mime, "text/html")).toContain("<p>Hello Sarah</p>");
  });

  it("marks itself honestly as bulk", () => {
    expect(mime).toContain("Precedence: bulk");
    expect(mime).toContain("Auto-Submitted: auto-generated");
  });

  it("gives the message an id on the sending domain", () => {
    const line = mime.split("\r\n").find((l) => l.startsWith("Message-ID:"))!;
    expect(line).toMatch(/@mankinfinance\.com>$/);
  });

  it("sends the From with a display name", () => {
    expect(mime).toContain("From: Michael Mankin <michael@mankinfinance.com>");
  });

  it("encodes a subject that is not plain ASCII", () => {
    const encoded = buildMimeMessage({
      ...BASE,
      subject: "Your rate — worth a look",
    });
    expect(encoded).toMatch(/Subject: =\?UTF-8\?B\?/);
    // And the em dash survives the round trip.
    const header = encoded.split("\r\n").find((l) => l.startsWith("Subject:"))!;
    const b64 = header.match(/=\?UTF-8\?B\?(.+)\?=/)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toContain("—");
  });

  it("leaves a plain ASCII subject readable", () => {
    expect(mime).toContain("Subject: Your ANZ rate is worth a look");
  });

  it("omits the mailto URI when none is configured", () => {
    const without = buildMimeMessage({ ...BASE, unsubscribeMailto: undefined });
    const header = without.split("\r\n").find((l) => l.startsWith("List-Unsubscribe:"))!;
    expect(header).not.toContain("mailto:");
    expect(header).toContain("https://");
  });

  it("wraps base64 bodies so no line exceeds the SMTP limit", () => {
    const long = buildMimeMessage({
      ...BASE,
      html: `<p>${"a very long sentence indeed. ".repeat(200)}</p>`,
    });
    for (const line of long.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });
});

describe("header injection", () => {
  /* The addresses reaching this module come from a public form endpoint
     a stranger can POST to, so the guarantee has to hold at the sink
     rather than depending on which fields that form asked for. */

  function withTo(to: string) {
    return () =>
      buildMimeMessage({
        ...BASE,
        to,
      });
  }

  it("refuses a recipient address carrying a line break", () => {
    expect(withTo("attacker@example.com\r\nBcc: victim@example.com")).toThrow(
      /line break/,
    );
    expect(withTo("attacker@example.com\nBcc: victim@example.com")).toThrow(
      /line break/,
    );
    expect(withTo("attacker@example.com\rX-Evil: 1")).toThrow(/line break/);
  });

  it("refuses a subject carrying a line break", () => {
    expect(() =>
      buildMimeMessage({
        ...BASE,
        subject: "Your rate\r\nBcc: victim@example.com",
      }),
    ).toThrow(/line break/);
  });

  it("refuses a sender name or address carrying a line break", () => {
    expect(() =>
      buildMimeMessage({ ...BASE, fromName: "Michael\r\nBcc: x@y.com" }),
    ).toThrow(/line break/);
    expect(() =>
      buildMimeMessage({ ...BASE, fromEmail: "mm@x.com\r\nBcc: y@z.com" }),
    ).toThrow(/line break/);
  });

  it("refuses an unsubscribe URL carrying a line break", () => {
    expect(() =>
      buildMimeMessage({
        ...BASE,
        unsubscribeUrl: "https://x.com/u\r\nX-Evil: 1",
      }),
    ).toThrow(/line break/);
  });

  it("still builds an ordinary message", () => {
    const mime = buildMimeMessage(BASE);
    expect(mime).toContain("To: sarah@example.com");
    // One To: header, not two.
    expect(mime.match(/^To:/gm)).toHaveLength(1);
    expect(mime).not.toMatch(/^Bcc:/m);
  });
});

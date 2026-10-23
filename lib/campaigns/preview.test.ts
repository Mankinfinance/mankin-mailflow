import { describe, it, expect } from "vitest";
import { previewEmail, previewFields } from "./preview";
import { MERGE_FIELDS } from "./audience";

describe("previewEmail", () => {
  it("fills every merge field the editor offers", () => {
    const fields = previewFields("mm");
    for (const f of MERGE_FIELDS) expect(fields[f], f).toBeDefined();
  });

  it("renders the body, the sending broker's details and the footer", () => {
    const r = previewEmail({
      subject: "{{first_name}}, your {{lender}} rate",
      body: "Hi {{first_name}},\n\n[Book a time]({{booking_url}})",
      brokerId: "mm",
    });
    expect(r.subject).toBe("Sarah, your Westpac rate");
    expect(r.html).toContain("Hi Sarah,");
    expect(r.html).toContain("tidycal.com/3qr45gm");
    expect(r.html).toContain("Michael Mankin");
    expect(r.html.toLowerCase()).toContain("unsubscribe");
    expect(r.html).not.toContain("{{");
  });

  it("shows the reply fallback for a broker with no booking link", () => {
    const r = previewEmail({ subject: "Hi", body: "[Book a time]({{booking_url}})", brokerId: "na" });
    expect(r.html).toContain("reply to this email");
  });
});

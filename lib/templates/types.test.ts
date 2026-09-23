import { describe, it, expect } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateConfigSchema,
  builtInTemplate,
} from "./types";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { unknownMergeFields } from "@/lib/campaigns/merge";
import { checkContent } from "@/lib/campaigns/spam-check";
import { MANKIN_REVIEW_URL } from "@/lib/email-signature";

describe("the built-in library", () => {
  it("has no duplicate ids", () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("files every template under a real category", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
    }
  });

  it("uses only merge fields the loan book can answer", () => {
    // The whole point of shipping a library is that it works on first
    // use. A template referencing {{lender_name}} would render an empty
    // gap in a customer's inbox.
    for (const t of BUILT_IN_TEMPLATES) {
      expect(unknownMergeFields(t.subject, MERGE_FIELDS)).toEqual([]);
      expect(unknownMergeFields(t.body, MERGE_FIELDS)).toEqual([]);
    }
  });

  it("gives every template a subject", () => {
    // A broker picking a template is usually most stuck on the subject
    // line, so shipping one without a subject misses the point.
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.subject.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every template a body worth starting from", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.body.trim().length).toBeGreaterThan(80);
    }
  });

  it("finds a template by id, and nothing by a made-up one", () => {
    expect(builtInTemplate("rate-review")?.name).toBe("Rate review");
    expect(builtInTemplate("does-not-exist")).toBeUndefined();
  });
});

describe("the library's house rules", () => {
  it("is a real library, with every shelf stocked", () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(40);
    for (const c of TEMPLATE_CATEGORIES) {
      const onShelf = BUILT_IN_TEMPLATES.filter((t) => t.category === c);
      expect(onShelf.length, c).toBeGreaterThanOrEqual(2);
    }
  });

  it("passes the spam check apart from the placeholders left to fill in", () => {
    // A template that trips the checker the moment it is picked teaches
    // people to ignore the checker. Placeholders are the one warning we
    // want, so nobody sends "[suburb]" to a client.
    for (const t of BUILT_IN_TEMPLATES) {
      const issues = checkContent({ subject: t.subject, body: t.body });
      const unexpected = issues.filter(
        (i) => i.severity === "warn" && !i.message.startsWith("A placeholder"),
      );
      expect(unexpected, t.id).toEqual([]);
      expect(
        issues.filter((i) => i.message.startsWith("Phrases filters weight")),
        t.id,
      ).toEqual([]);
    }
  });

  it("keeps subjects short enough to read in full on a phone", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.subject.length, t.id).toBeLessThanOrEqual(70);
    }
  });

  it("writes like a broker, not a marketer", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const text = `${t.subject}\n${t.body}`;
      expect(text, t.id).not.toContain("\u2014");
      expect(text, t.id).not.toContain("!");
      expect(text.toLowerCase(), t.id).not.toContain("no obligation");
    }
  });

  it("books through each broker's own link, never a hard-coded one", () => {
    // A hard-coded booking URL sends every client to one person's
    // calendar. The only other link allowed is the Google review page.
    for (const t of BUILT_IN_TEMPLATES) {
      const links = [...t.body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      for (const href of links) {
        expect(
          href === "{{booking_url}}" || href === MANKIN_REVIEW_URL,
          `${t.id}: ${href}`,
        ).toBe(true);
      }
    }
  });

  it("does not name a lender to people who have not settled yet", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      if (t.category === "Pipeline" || t.category === "Goals") {
        expect(t.body, t.id).not.toContain("{{lender}}");
      }
    }
  });
});

describe("TemplateConfigSchema", () => {
  it("fills in every field, so an old row keeps parsing", () => {
    const parsed = TemplateConfigSchema.parse({});
    expect(parsed.subject).toBe("");
    expect(parsed.body).toBe("");
    expect(parsed.description).toBe("");
    expect(TEMPLATE_CATEGORIES).toContain(parsed.category);
  });

  it("refuses a category that is not one of ours", () => {
    expect(() =>
      TemplateConfigSchema.parse({ category: "Abandoned cart" }),
    ).toThrow();
  });
});

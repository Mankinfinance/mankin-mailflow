import { describe, it, expect } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateConfigSchema,
  builtInTemplate,
} from "./types";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { unknownMergeFields } from "@/lib/campaigns/merge";

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

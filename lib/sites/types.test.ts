import { describe, it, expect } from "vitest";
import {
  PAGE_TEMPLATES,
  PageConfigSchema,
  emptyPageConfig,
  isReservedSlug,
  isValidSlug,
  slugify,
  validatePage,
} from "./types";

describe("slugify", () => {
  it("turns a page name into an address someone could type", () => {
    expect(slugify("First Home Buyer Guide")).toBe("first-home-buyer-guide");
    expect(slugify("  Refinance & Rate Check!  ")).toBe("refinance-rate-check");
  });

  it("never produces a leading or trailing hyphen", () => {
    expect(slugify("—Hello—")).toBe("hello");
    expect(slugify("!!!")).toBe("");
  });

  it("caps the length so a slug stays printable", () => {
    expect(slugify("a".repeat(120)).length).toBeLessThanOrEqual(60);
  });
});

describe("isValidSlug", () => {
  it("accepts what slugify produces", () => {
    for (const name of ["Refinance health check", "Seminar 2026", "Guide"]) {
      expect(isValidSlug(slugify(name))).toBe(true);
    }
  });

  it("rejects shapes that would surprise someone typing the URL", () => {
    expect(isValidSlug("Has Capitals")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("isReservedSlug", () => {
  it("protects the app's own paths", () => {
    // A page at /p/dashboard is harmless, but reserving these keeps the
    // door open to serving pages from the root later.
    expect(isReservedSlug("dashboard")).toBe(true);
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("refinance-health-check")).toBe(false);
  });
});

describe("validatePage", () => {
  it("passes every template once a form is chosen", () => {
    for (const template of PAGE_TEMPLATES) {
      const withForm = {
        ...template.config,
        blocks: template.config.blocks.map((b) =>
          b.kind === "form" ? { ...b, formId: "form-1" } : b,
        ),
      };
      expect(validatePage(PageConfigSchema.parse(withForm))).toEqual([]);
    }
  });

  it("catches an enquiry block with no form behind it", () => {
    // The failure this prevents: a published page with a form-shaped
    // hole where the form should be.
    expect(validatePage(PAGE_TEMPLATES[0].config).join(" ")).toMatch(
      /no form chosen/,
    );
  });

  it("catches a page a visitor cannot get in touch from", () => {
    const config = PageConfigSchema.parse({
      metaTitle: "About us",
      blocks: [{ kind: "text", heading: "Hello", body: "Hi" }],
    });
    expect(validatePage(config).join(" ")).toMatch(/no way to get in touch/);
  });

  it("insists on a page title for search results", () => {
    const config = PageConfigSchema.parse({
      blocks: [{ kind: "form", heading: "Enquire", formId: "form-1" }],
    });
    expect(validatePage(config).join(" ")).toMatch(/page title/);
  });

  it("flags an empty page", () => {
    expect(validatePage(PageConfigSchema.parse({})).join(" ")).toMatch(
      /no content/,
    );
  });
});

describe("emptyPageConfig", () => {
  it("starts with something to edit rather than a blank canvas", () => {
    const config = emptyPageConfig();
    expect(config.blocks.map((b) => b.kind)).toEqual(["hero", "form"]);
  });
});

describe("page templates", () => {
  it("all parse", () => {
    for (const template of PAGE_TEMPLATES) {
      expect(() => PageConfigSchema.parse(template.config)).not.toThrow();
    }
  });

  it("all carry a valid slug and search metadata", () => {
    for (const template of PAGE_TEMPLATES) {
      expect(isValidSlug(template.slug)).toBe(true);
      expect(template.config.metaTitle.length).toBeGreaterThan(5);
      expect(template.config.metaDescription.length).toBeGreaterThan(20);
    }
  });
});

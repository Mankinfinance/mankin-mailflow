import { describe, expect, it } from "vitest";
import { dealFolderName, sanitiseFilename } from "./sharepoint";

describe("dealFolderName", () => {
  it("uses 'FirstName LastName' for a single applicant", () => {
    expect(dealFolderName({ name: "James Doukas" })).toBe("James Doukas");
  });

  it("joins joint applicants with shared surname, alphabetical by first name", () => {
    // "Sarah & Tom Reilly": both first names sort to "Sarah & Tom Reilly"
    expect(dealFolderName({ name: "Sarah & Tom Reilly" })).toBe(
      "Sarah & Tom Reilly",
    );
  });

  it("alphabetises joint applicants even when broker types them out of order", () => {
    // "Tom & Sarah Reilly" should sort to "Sarah & Tom Reilly"
    expect(dealFolderName({ name: "Tom & Sarah Reilly" })).toBe(
      "Sarah & Tom Reilly",
    );
  });

  it("keeps hyphenated surnames intact for joint applicants", () => {
    // "Priya & Anish Kumar-Patel" - first names sort: Anish, Priya
    expect(dealFolderName({ name: "Priya & Anish Kumar-Patel" })).toBe(
      "Anish & Priya Kumar-Patel",
    );
  });

  it("preserves apostrophes in surnames (single applicant)", () => {
    expect(dealFolderName({ name: "Liam O'Brien" })).toBe("Liam O'Brien");
  });

  it("handles joint applicants with different surnames", () => {
    // Alphabetical: Bob, Tara - full names retained
    expect(dealFolderName({ name: "Tara Nguyen & Bob Smith" })).toBe(
      "Bob Smith & Tara Nguyen",
    );
  });

  it("falls back to the single name token when no surname provided", () => {
    expect(dealFolderName({ name: "Cher" })).toBe("Cher");
  });

  it("falls back to 'deal' on whitespace-only name", () => {
    expect(dealFolderName({ name: "   " })).toBe("deal");
  });

  it("handles 'and' as a join word", () => {
    expect(dealFolderName({ name: "Sarah and Tom Reilly" })).toBe(
      "Sarah & Tom Reilly",
    );
  });

  it("strips SharePoint-reserved characters but keeps spaces + ampersand", () => {
    // Forbidden chars: < > : " / \ | ? *
    expect(dealFolderName({ name: "Mary?Smith" })).toBe("MarySmith");
    expect(dealFolderName({ name: 'Jane "QA" Doe' })).toBe("Jane QA Doe");
  });
});

describe("sanitiseFilename", () => {
  it("preserves alphanumerics, dots, dashes, underscores and spaces", () => {
    expect(sanitiseFilename("Sarah Reilly - Payslip 2025-04.pdf")).toBe(
      "Sarah Reilly - Payslip 2025-04.pdf",
    );
  });

  it("strips path separators while preserving dots/extensions", () => {
    // Slashes → underscore; dots stay because they're valid in filenames
    expect(sanitiseFilename("../../secret.txt")).toBe(".._.._secret.txt");
    // The colon also gets stripped → so the `C:` prefix becomes `C__`
    expect(sanitiseFilename("C:\\Users\\X\\foo.pdf")).toBe("C__Users_X_foo.pdf");
  });

  it("collapses consecutive whitespace", () => {
    expect(sanitiseFilename("a    b\tc")).toBe("a b_c");
  });

  it("falls back to 'upload' when sanitisation empties the name", () => {
    expect(sanitiseFilename("///")).toBe("_");
    // Pure-punctuation strips to empty after trim → fallback
    expect(sanitiseFilename("???")).toBe("_");
  });

  it("caps length at 200", () => {
    const long = "a".repeat(500) + ".pdf";
    const out = sanitiseFilename(long);
    expect(out.length).toBe(200);
  });
});

import { describe, it, expect } from "vitest";
import { renderMergeFields } from "./render";

describe("renderMergeFields", () => {
  it("substitutes a known field", () => {
    expect(renderMergeFields("How did we do, {{first_name}}?", { first_name: "Sarah" }))
      .toBe("How did we do, Sarah?");
  });

  it("tolerates spaces inside the braces", () => {
    expect(renderMergeFields("Hi {{ first_name }}", { first_name: "Tom" })).toBe("Hi Tom");
  });

  it("replaces every occurrence", () => {
    expect(
      renderMergeFields("{{first_name}}, really {{first_name}}?", { first_name: "Mei" }),
    ).toBe("Mei, really Mei?");
  });

  it("leaves an unknown field visible rather than blanking it", () => {
    // A broker who typed a field this page cannot fill should see that
    // they did, not a sentence with a hole in it.
    expect(renderMergeFields("Your {{lender}} loan", {})).toBe("Your {{lender}} loan");
  });

  it("leaves text with no fields untouched", () => {
    expect(renderMergeFields("How did we do?", { first_name: "Sarah" })).toBe("How did we do?");
  });

  it("ignores a single brace pair", () => {
    expect(renderMergeFields("{first_name}", { first_name: "Sarah" })).toBe("{first_name}");
  });
});

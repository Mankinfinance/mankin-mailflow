import { describe, it, expect } from "vitest";
import { AUTOMATION_TEMPLATES } from "./types";
import { MERGE_FIELDS } from "@/lib/campaigns/audience";
import { unknownMergeFields } from "@/lib/campaigns/merge";

const emails = AUTOMATION_TEMPLATES.flatMap((t) =>
  t.flow.nodes
    .filter((n) => n.kind === "send" || n.kind === "survey")
    .map((n) => ({ id: `${t.id}/${n.id}`, kind: n.kind, subject: n.subject ?? "", body: n.body ?? "" })),
);

describe("automation template emails", () => {
  it("do not sign off themselves, because the signature already does", () => {
    // A body ending in {{broker_name}} printed the name twice: once from
    // the body, once at the top of the signature.
    for (const e of emails) {
      const last = e.body.trim().split("\n").pop()!.trim();
      expect(last, e.id).not.toMatch(/^\{\{broker_(name|first_name|phone)\}\}$/);
    }
  });

  it("only use merge fields a run can fill", () => {
    for (const e of emails) {
      const known = e.kind === "survey" ? [...MERGE_FIELDS, "survey_link"] : [...MERGE_FIELDS];
      expect(unknownMergeFields(e.subject, known), e.id).toEqual([]);
      expect(unknownMergeFields(e.body, known), e.id).toEqual([]);
    }
  });
});

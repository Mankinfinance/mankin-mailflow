import { describe, it, expect, beforeEach, vi } from "vitest";
import { FormConfigSchema, conversionRate, FORM_TEMPLATES } from "./types";
import { validateSubmission } from "./submit";

/* The real client reads deals through Next's unstable_cache, which has
   no request scope here. The deal list is only used to pick the next
   MF-NNNN reference, so a stub is enough. */
vi.mock("@/lib/clients/salestrekker", () => ({
  getSalestrekkerClient: () => ({
    listDeals: async () => [{ appRef: "MF-0041" }],
  }),
}));

const { submitForm, resolvePageAttribution } = await import("./submit");
const { repos } = await import("@/lib/db/repos");

function config(over: Record<string, unknown> = {}) {
  return FormConfigSchema.parse({
    destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    ...over,
  });
}

function input(over: Record<string, unknown> = {}) {
  return {
    name: "Sarah Chen",
    email: "sarah@example.com",
    phone: "0400 000 000",
    answers: {},
    ...over,
  };
}

describe("validateSubmission", () => {
  it("accepts a complete enquiry", () => {
    expect(validateSubmission(input(), config())).toBeNull();
  });

  it("insists on the fields the form asks for", () => {
    expect(validateSubmission(input({ name: "" }), config())).toMatch(/your name/);
    expect(validateSubmission(input({ email: "" }), config())).toMatch(/email/);
    expect(validateSubmission(input({ phone: "" }), config())).toMatch(/phone/);
  });

  it("ignores a field the form does not ask for", () => {
    const emailOnly = config({ fields: ["email"] });
    expect(validateSubmission(input({ name: "", phone: "" }), emailOnly)).toBeNull();
  });

  it("rejects an address that cannot receive a reply", () => {
    expect(validateSubmission(input({ email: "not-an-address" }), config())).toMatch(
      /does not look right/,
    );
  });

  it("refuses a form with no way to reply at all", () => {
    const noContact = config({ fields: ["name", "message"] });
    expect(validateSubmission(input(), noContact)).toMatch(/not accepting/);
  });
});

describe("conversionRate", () => {
  it("is null before anyone has seen the form", () => {
    // Not 0%: a form nobody has loaded has not failed to convert.
    expect(conversionRate(0, 0)).toBeNull();
  });

  it("divides submissions by views", () => {
    expect(conversionRate(11, 100)).toBeCloseTo(11);
  });
});

describe("form templates", () => {
  it("every template parses as a valid config", () => {
    for (const template of FORM_TEMPLATES) {
      expect(() => FormConfigSchema.parse(template.config)).not.toThrow();
    }
  });

  it("every template can be replied to", () => {
    // A template that collects neither an email nor a phone would create
    // enquiries nobody can answer.
    for (const template of FORM_TEMPLATES) {
      const fields = template.config.fields;
      expect(fields.includes("email") || fields.includes("phone")).toBe(true);
    }
  });

  it("every template states a consent line", () => {
    for (const template of FORM_TEMPLATES) {
      expect(template.config.consent.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("submitForm", () => {
  beforeEach(async () => {
    for (const f of await repos().form.list()) {
      await repos().form.remove(f.id);
    }
  });

  async function liveForm(over: Record<string, unknown> = {}) {
    return repos().form.create({
      name: "Home loan enquiry",
      type: "embedded",
      status: "live",
      config: config(over),
      createdBy: "mm",
    });
  }

  it("records the enquiry and creates a pipeline deal", async () => {
    const form = await liveForm();

    const result = await submitForm(form, input({ answers: { "loan-purpose": "Refinance an existing loan" } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Numbered on from the highest existing reference.
    expect(result.dealRef).toBe("MF-0042");

    const submissions = await repos().form.listSubmissions(form.id);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].dealId).toBeTruthy();
    expect(submissions[0].email).toBe("sarah@example.com");
  });

  it("records the enquiry even when no deal is wanted", async () => {
    const form = await liveForm({ destination: { kind: "register-only" } });

    const result = await submitForm(form, input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dealRef).toBeNull();
    expect(await repos().form.listSubmissions(form.id)).toHaveLength(1);
  });

  it("refuses a form that is not live", async () => {
    const form = await repos().form.create({
      name: "Draft",
      type: "embedded",
      status: "draft",
      config: config(),
      createdBy: "mm",
    });

    const result = await submitForm(form, input());

    expect(result).toEqual({ ok: false, error: "This form is not accepting enquiries." });
    expect(await repos().form.listSubmissions(form.id)).toHaveLength(0);
  });

  it("keeps the enquiry when deal creation fails", async () => {
    // The reliability property: a public form is the one place the
    // person on the other end cannot be asked to try again.
    const form = await liveForm();
    const spy = vi
      .spyOn(repos().deal, "add")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const result = await submitForm(form, input());

    // The customer is told it worked, because for them it did.
    expect(result.ok).toBe(true);
    const submissions = await repos().form.listSubmissions(form.id);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].dealId).toBeNull();
    expect(submissions[0].error).toContain("database unavailable");
    spy.mockRestore();
  });

  it("lower-cases the address so it matches the rest of the system", async () => {
    const form = await liveForm();
    await submitForm(form, input({ email: "Sarah@Example.COM" }));
    const submissions = await repos().form.listSubmissions(form.id);
    expect(submissions[0].email).toBe("sarah@example.com");
  });
});

describe("landing page attribution", () => {
  beforeEach(async () => {
    for (const f of await repos().form.list()) await repos().form.remove(f.id);
    for (const p of await repos().landingPage.list()) {
      await repos().landingPage.remove(p.id);
    }
  });

  async function liveForm() {
    return repos().form.create({
      name: "Home loan enquiry",
      type: "embedded",
      status: "live",
      config: config(),
      createdBy: "mm",
    });
  }

  async function page(formId: string, over: Record<string, unknown> = {}) {
    return repos().landingPage.create({
      name: "Refinance health check",
      slug: `refinance-${Math.random().toString(36).slice(2, 8)}`,
      status: "published",
      createdBy: "mm",
      config: {
        blocks: [
          { kind: "hero", heading: "Is your rate still competitive?" },
          { kind: "form", formId },
        ],
      },
      ...over,
    });
  }

  it("attributes an enquiry to the page it came through", async () => {
    const form = await liveForm();
    const landing = await page(form.id);

    await submitForm(form, input({ pageId: landing.id }));

    const [submission] = await repos().form.listSubmissions(form.id);
    expect(submission.pageId).toBe(landing.id);
  });

  it("records no page for the hosted form and the embed", async () => {
    const form = await liveForm();
    await submitForm(form, input());
    const [submission] = await repos().form.listSubmissions(form.id);
    expect(submission.pageId).toBeNull();
  });

  it("refuses a page id from a stranger inflating someone else's page", async () => {
    // The endpoint is public, so the claim has to be checked rather
    // than trusted: this page does not embed this form.
    const form = await liveForm();
    const other = await repos().form.create({
      name: "Seminar registration",
      type: "embedded",
      status: "live",
      config: config(),
      createdBy: "mm",
    });
    const landing = await page(other.id);

    expect(await resolvePageAttribution(landing.id, form.id)).toBeNull();
  });

  it("ignores a page that is not published", async () => {
    const form = await liveForm();
    const draft = await page(form.id, { status: "draft" });
    expect(await resolvePageAttribution(draft.id, form.id)).toBeNull();
  });

  it("ignores a page id that names nothing", async () => {
    const form = await liveForm();
    expect(await resolvePageAttribution("page-does-not-exist", form.id)).toBeNull();
  });

  it("still records the enquiry when the claim is rejected", async () => {
    // A bad attribution must never cost the enquiry itself.
    const form = await liveForm();
    const result = await submitForm(form, input({ pageId: "page-does-not-exist" }));

    expect(result.ok).toBe(true);
    const [submission] = await repos().form.listSubmissions(form.id);
    expect(submission.email).toBe("sarah@example.com");
    expect(submission.pageId).toBeNull();
  });

  it("counts conversions per page, not per form", async () => {
    // The bug this fixes: a form embedded on two pages reported the
    // same total on both, and a page that had never been visited
    // claimed enquiries that arrived somewhere else.
    const form = await liveForm();
    const a = await page(form.id);
    const b = await page(form.id);

    await submitForm(form, input({ pageId: a.id }));
    await submitForm(form, input({ pageId: a.id }));
    await submitForm(form, input({ pageId: b.id }));
    await submitForm(form, input());

    expect(await repos().form.pageSubmissionCounts()).toEqual({
      [a.id]: 2,
      [b.id]: 1,
    });
    // The form's own total still counts every one of them.
    const byForm = await repos().form.submissionCounts();
    expect(byForm[form.id]).toBe(4);
  });
});

describe("address validation at the public boundary", () => {
  it("rejects a malformed address even when the form never asked for one", () => {
    /* The endpoint takes whatever JSON it is given. A form whose field
       list omits "email" would otherwise store an unvalidated address,
       and that address goes on to become a campaign recipient — where
       a CRLF in it would forge headers on a DKIM-signed message. */
    const phoneOnly = config({ fields: ["name", "phone"] });
    const injected = input({
      email: "attacker@example.com\r\nBcc: victim@example.com",
    });
    expect(validateSubmission(injected, phoneOnly)).toMatch(/does not look right/);
  });

  it("still accepts a blank address on a form that does not ask for one", () => {
    const phoneOnly = config({ fields: ["name", "phone"] });
    expect(validateSubmission(input({ email: "" }), phoneOnly)).toBeNull();
  });

  it("rejects a line break on a form that does ask for an address", () => {
    expect(
      validateSubmission(
        input({ email: "a@b.com\nBcc: victim@example.com" }),
        config(),
      ),
    ).toMatch(/does not look right/);
  });
});

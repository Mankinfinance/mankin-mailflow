import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { getSalestrekkerClient } from "@/lib/clients/salestrekker";
import type { Deal } from "@/lib/clients/salestrekker/types";
import { FormConfigSchema, type FormConfig } from "./types";
import { PageConfigSchema } from "@/lib/sites/types";
import type { FormRow } from "@/lib/db/schema";

/**
 * Turning a public enquiry into a deal.
 *
 * The submission row is written first and the deal second, so an
 * enquiry is never lost to a failure further down: if deal creation
 * throws, the row survives carrying the error, and the broker sees an
 * enquiry that needs picking up by hand rather than nothing at all.
 *
 * That ordering is the whole reliability story of this module. A form
 * on a public website is the one place in the product where the person
 * on the other end cannot be asked to try again.
 */

export interface SubmissionInput {
  name: string;
  email: string;
  phone: string;
  /** Everything else, keyed by field id. */
  answers: Record<string, string>;
  /** The landing page this enquiry claims to have come through. An
   *  unverified value straight off a public request — `submitForm`
   *  checks it before recording anything. */
  pageId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export type SubmissionResult =
  | { ok: true; thanks: string; dealRef: string | null }
  | { ok: false; error: string };

/** Validation the public endpoint can trust. Deliberately forgiving on
 *  shape and strict on the two things that matter: a way to reply, and
 *  something to call the person. */
export function validateSubmission(
  input: SubmissionInput,
  config: FormConfig,
): string | null {
  const wantsEmail = config.fields.includes("email");
  const wantsPhone = config.fields.includes("phone");

  const email = input.email.trim();
  const phone = input.phone.trim();

  if (wantsEmail && !email) return "Please add an email address.";
  /* Shape-checked whenever an address is present, not only when this
     form asked for one. The endpoint is public and takes whatever JSON
     it is given, so a form whose field list omits "email" would
     otherwise store an unvalidated one — and that address goes on to
     become a campaign recipient. */
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "That email address does not look right.";
  }
  if (wantsPhone && !phone) return "Please add a phone number.";
  if (config.fields.includes("name") && !input.name.trim()) {
    return "Please add your name.";
  }
  // A form asking for neither is a form nobody can reply to.
  if (!wantsEmail && !wantsPhone) {
    return "This form is not accepting enquiries.";
  }
  return null;
}

/**
 * Attribution is only as good as its weakest claim.
 *
 * The page id arrives in the body of a public, unauthenticated request,
 * so a stranger could otherwise post any id they liked and inflate a
 * page's conversion figure — the one number a broker would use to
 * decide whether a page is worth keeping. It is accepted only when it
 * names a published page that actually embeds this form.
 *
 * A claim that fails is recorded as no page rather than rejecting the
 * enquiry: the enquiry itself is still real, and losing it would be far
 * the worse outcome. This lives here rather than in the route so that
 * every path into `submitForm` is checked, including ones not written
 * yet.
 */
export async function resolvePageAttribution(
  claimed: string | null | undefined,
  formId: string,
): Promise<string | null> {
  if (!claimed) return null;

  const page = await repos().landingPage.get(claimed);
  if (!page || page.status !== "published") return null;

  const parsed = PageConfigSchema.safeParse(page.config);
  if (!parsed.success) return null;

  const embedsForm = parsed.data.blocks.some(
    (b) => b.kind === "form" && b.formId === formId,
  );
  return embedsForm ? page.id : null;
}

export async function submitForm(
  form: FormRow,
  input: SubmissionInput,
): Promise<SubmissionResult> {
  if (form.status !== "live") {
    return { ok: false, error: "This form is not accepting enquiries." };
  }

  const parsed = FormConfigSchema.safeParse(form.config);
  if (!parsed.success) {
    return { ok: false, error: "This form is not configured correctly." };
  }
  const config = parsed.data;

  const problem = validateSubmission(input, config);
  if (problem) return { ok: false, error: problem };

  // Record the enquiry before anything can fail.
  const submission = await repos().form.addSubmission({
    formId: form.id,
    pageId: await resolvePageAttribution(input.pageId, form.id),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    answers: input.answers,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  if (config.destination.kind === "register-only") {
    await auditLog({
      actor: { type: "system" },
      action: "form.submit",
      meta: { formId: form.id, destination: "register-only" },
    });
    return { ok: true, thanks: config.thanks, dealRef: null };
  }

  try {
    const { dealId, appRef } = await createDealFromSubmission(
      input,
      config.destination.stageId,
      config.destination.brokerId,
      form.name,
    );
    await repos().form.updateSubmission(submission.id, { dealId });
    await auditLog({
      actor: { type: "system" },
      action: "form.submit",
      dealId,
      meta: { formId: form.id, appRef, formName: form.name },
    });
    return { ok: true, thanks: config.thanks, dealRef: appRef };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repos().form.updateSubmission(submission.id, {
      error: message.slice(0, 500),
    });
    console.error(`[form ${form.id}] deal creation failed`, err);
    // The customer is told it worked, because for them it did — their
    // details are recorded and a broker will see the enquiry. Surfacing
    // an internal failure to them would just make them submit again.
    await auditLog({
      actor: { type: "system" },
      action: "form.submit.deal_failed",
      meta: { formId: form.id, error: message.slice(0, 200) },
    });
    return { ok: true, thanks: config.thanks, dealRef: null };
  }
}

/**
 * Create the pipeline deal. Mirrors the referrer lead path — same ref
 * format, same starting doc list — so an enquiry from the website and
 * one from a referral partner arrive looking identical in the pipeline.
 */
async function createDealFromSubmission(
  input: SubmissionInput,
  stageId: string,
  brokerId: string,
  formName: string,
): Promise<{ dealId: string; appRef: string }> {
  const client = getSalestrekkerClient();
  const existing = await client.listDeals();
  const maxRef = existing.reduce((max, d) => {
    const m = /^MF-(\d+)$/.exec(d.appRef);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const appRef = `MF-${String(maxRef + 1).padStart(4, "0")}`;
  const dealId = `form-${crypto.randomUUID().slice(0, 8)}`;

  const purpose = purposeFrom(input.answers["loan-purpose"]);

  const deal: Deal = {
    id: dealId,
    appRef,
    name: input.name.trim() || input.email.trim(),
    email: input.email.trim(),
    secondaryEmail: "",
    phone: input.phone.trim(),
    stageId: stageId as Deal["stageId"],
    daysSinceContact: 0,
    lastContactAt: new Date(),
    stageEnteredAt: new Date(),
    lender: "TBC",
    settlement: "TBD",
    avatar: "#c7b8ea",
    brokerId,
    associateId: "mp",
    received: [],
    pending: ["privacy-form", "photo-id", "payslips"],
    overdue: [],
    advisory: [],
    excluded: [],
    customDocs: [],
    loanAmount: null,
    settledOn: null,
    preApprovalDate: null,
    preApprovalExpiry: null,
    excludeFromDailyUpdates: false,
    purpose,
    conveyancer: null,
    nurturedAt: null,
    nurtureReason: null,
    leadCategory: purpose === "unknown" ? "unknown" : purpose,
    leadSource: "Website",
    mankinStage: "Awaiting Documents",
    priorityFlag: null,
    comments: buildComments(input, formName),
    referrer: null,
    referrerId: null,
    giftcardSent: false,
    commission: null,
    applicants: [],
    guarantors: [],
    systemAddedAt: new Date().toISOString(),
  } as Deal;

  await repos().deal.add(deal);
  return { dealId, appRef };
}

function purposeFrom(raw: string | undefined): "purchase" | "refinance" | "unknown" {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("refinance") || value.includes("refi")) return "refinance";
  if (value.includes("buy") || value.includes("purchase")) return "purchase";
  return "unknown";
}

/** Everything the customer typed that has no column of its own, kept
 *  together so a broker opening the deal reads the enquiry as written. */
function buildComments(input: SubmissionInput, formName: string): string {
  const lines = [`Enquiry via ${formName}.`];
  for (const [key, value] of Object.entries(input.answers)) {
    if (!value?.trim()) continue;
    if (key === "loan-purpose") lines.push(`Looking to: ${value.trim()}`);
    else if (key === "message") lines.push(value.trim());
    else lines.push(`${key}: ${value.trim()}`);
  }
  return lines.join("\n");
}

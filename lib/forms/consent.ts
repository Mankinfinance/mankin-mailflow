import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { sendMimeViaGraph } from "@/lib/clients/outlook-mime";
import { issueTrackingToken, verifyTrackingToken } from "@/lib/campaigns/tracking";
import { portalBaseUrl } from "@/lib/portal-link";
import { currentSettings } from "@/lib/mailflow/current-settings";
import { teamMember } from "@/lib/team";
import type { FormSubmissionRow } from "@/lib/db/schema";
import { DEFAULT_MARKETING_LABEL, type ConsentStatus, type FormConfig } from "./types";

/**
 * The consent record on an enquiry, and double opt-in.
 *
 * Every enquiry stores what the person was shown (the consent line, and
 * the marketing box's wording when there is one) and what they did. A
 * double opt-in form then emails a link they have to click before the
 * tick counts, which proves the address is theirs and not one somebody
 * else typed in.
 */

/** Confirmation links stop working after this long. */
export const CONFIRM_WINDOW_DAYS = 30;

const PREFIX = "form:";

export function consentFor(
  config: FormConfig,
  optedIn: boolean,
  hasEmail: boolean,
): { status: ConsentStatus; text: string; sendConfirmation: boolean } {
  const marketing = config.marketing;
  if (!marketing?.ask) {
    return { status: "enquiry", text: config.consent, sendConfirmation: false };
  }
  const label = marketing.label || DEFAULT_MARKETING_LABEL;
  const text = `${config.consent}\n[${optedIn ? "x" : " "}] ${label}`;
  if (!optedIn) return { status: "declined", text, sendConfirmation: false };
  if (marketing.doubleOptIn && hasEmail) {
    return { status: "pending", text, sendConfirmation: true };
  }
  return { status: "opted-in", text, sendConfirmation: false };
}

/** A tick-box value off a public form post: only an explicit yes counts. */
export function tickedYes(value: string | undefined): boolean {
  return value === "yes" || value === "on" || value === "true";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function confirmationEmail(args: {
  name: string;
  url: string;
  fromName: string;
  postalAddress: string;
}): { subject: string; html: string; text: string } {
  const first = args.name.trim().split(/\s+/)[0] || "there";
  const subject = "Please confirm your email address";
  const text = [
    `Hi ${first},`,
    "",
    "Thanks for getting in touch with Mankin Finance. You asked to receive occasional emails from us.",
    "Please confirm this is your address by opening this link:",
    "",
    args.url,
    "",
    "If you didn't ask for this, ignore this email and you won't get any marketing from us.",
    "",
    args.fromName,
    "Mankin Finance",
    args.postalAddress,
  ]
    .join("\n")
    .trim();

  const font = "font-family:Arial,Helvetica,sans-serif;";
  const html = `<!doctype html><html lang="en-AU"><body style="margin:0;padding:24px 16px;background:#f7f4ee;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px 24px;${font}color:#22253a;font-size:15px;line-height:1.55;">
<p style="margin:0 0 14px;">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 14px;">Thanks for getting in touch with Mankin Finance. You asked to receive occasional emails from us. Please confirm this is your address.</p>
<p style="margin:22px 0;"><a href="${escapeHtml(args.url)}" style="display:inline-block;background:#161461;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">Yes, send me emails</a></p>
<p style="margin:0 0 14px;color:#5f636e;font-size:13px;">If you didn't ask for this, ignore this email and you won't get any marketing from us.</p>
<p style="margin:18px 0 0;">${escapeHtml(args.fromName)}<br>Mankin Finance</p>
${args.postalAddress ? `<p style="margin:18px 0 0;color:#8a8d96;font-size:12px;">${escapeHtml(args.postalAddress)}</p>` : ""}
</div></body></html>`;

  return { subject, html, text };
}

/**
 * Email the confirmation link. Never throws: the enquiry is already
 * recorded, and a failed confirmation email leaves it "pending", which
 * is the safe side (no marketing until they confirm).
 */
export async function sendConfirmation(args: {
  submission: Pick<FormSubmissionRow, "id" | "email" | "name">;
  config: FormConfig;
  formId: string;
}): Promise<boolean> {
  try {
    const token = await issueTrackingToken({
      cid: `${PREFIX}${args.submission.id}`,
      em: args.submission.email,
      p: "confirm",
    });
    const url = `${portalBaseUrl()}/e/confirm/${token}`;
    /* From the broker the enquiry goes to, so the confirmation and the
       follow-up call come from the same person; the Client Experience
       mailbox when the form only records. */
    const sender = teamMember(
      args.config.destination.kind === "pipeline" ? args.config.destination.brokerId : "ceo",
    );
    const settings = await currentSettings();
    const message = confirmationEmail({
      name: args.submission.name,
      url,
      fromName: sender.name,
      postalAddress: settings.postalAddress,
    });
    await sendMimeViaGraph({
      fromEmail: sender.email,
      fromName: sender.name,
      to: args.submission.email,
      ...message,
    });
    return true;
  } catch (err) {
    console.error(`[form ${args.formId}] confirmation email failed`, err);
    await auditLog({
      actor: { type: "system" },
      action: "form.confirm.send-failed",
      meta: {
        formId: args.formId,
        submissionId: args.submission.id,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      },
    });
    return false;
  }
}

export type ConfirmOutcome =
  | { ok: true; already: boolean }
  | { ok: false; reason: "invalid" | "expired" };

/** Look up what a confirmation link points at, without changing it. */
export async function findConfirmable(
  token: string,
): Promise<{ submission: FormSubmissionRow } | { error: "invalid" | "expired" }> {
  const verified = await verifyTrackingToken(token, "confirm");
  if (!verified.ok) return { error: verified.reason === "expired" ? "expired" : "invalid" };
  const { cid, em } = verified.claims;
  if (!cid.startsWith(PREFIX)) return { error: "invalid" };

  const submission = await repos().form.getSubmission(cid.slice(PREFIX.length));
  if (!submission || submission.email !== em.toLowerCase()) return { error: "invalid" };

  const age = Date.now() - submission.submittedAt.getTime();
  if (submission.consentStatus === "pending" && age > CONFIRM_WINDOW_DAYS * 86_400_000) {
    return { error: "expired" };
  }
  return { submission };
}

/**
 * Confirm. Only a "pending" enquiry moves; confirming twice is a
 * harmless no-op, and nothing else (a declined enquiry, say) can be
 * turned into consent by a link.
 */
export async function confirmByToken(token: string): Promise<ConfirmOutcome> {
  const found = await findConfirmable(token);
  if ("error" in found) return { ok: false, reason: found.error };
  const { submission } = found;

  if (submission.consentStatus === "confirmed") return { ok: true, already: true };
  if (submission.consentStatus !== "pending") return { ok: false, reason: "invalid" };

  await repos().form.updateSubmission(submission.id, {
    consentStatus: "confirmed",
    confirmedAt: new Date(),
  });
  await auditLog({
    actor: { type: "system" },
    action: "form.consent.confirmed",
    meta: { formId: submission.formId, submissionId: submission.id },
  });
  return { ok: true, already: false };
}

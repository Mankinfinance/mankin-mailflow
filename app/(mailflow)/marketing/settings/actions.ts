"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { MailflowSettingsSchema, SignatureSchema } from "@/lib/mailflow/settings";
import { currentSettings } from "@/lib/mailflow/current-settings";

/**
 * Saving the module's settings.
 *
 * Admin-gated like everything else in Mailflow — the footer here goes
 * out under the firm's name on every campaign, and the send pace
 * governs how fast the whole back-book is mailed.
 */

type Result = { ok: true } | { ok: false; error: string };

export async function saveSettingsAction(input: unknown): Promise<Result> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to change settings." };
  }

  const parsed = MailflowSettingsSchema.safeParse(input);
  if (!parsed.success) {
    /* Surface the first complaint rather than the whole Zod tree: the
       only fields a broker can get wrong are the pace bounds and the
       mailbox, and one plain sentence is more use than five. */
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid settings.",
    };
  }

  const settings = parsed.data;

  /* An unsubscribe mailbox has to be a real address. A typo here means
     a mail client offers a one-click unsubscribe that silently bounces,
     which is worse than never offering it — the request is made, the
     obligation attaches, and nobody ever sees it. */
  const mailto = settings.unsubscribeMailto.trim();
  if (mailto && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailto)) {
    return {
      ok: false,
      error: "That unsubscribe mailbox does not look like an email address.",
    };
  }

  /* The signature has its own form and its own save. Taking it from
     what is stored, never from this form, means a Settings form left
     open with a stale copy cannot overwrite a signature saved since. */
  const stored = await currentSettings();
  await repos().settings.save(
    { ...settings, unsubscribeMailto: mailto, signature: stored.signature },
    broker.id,
  );

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "mailflow.settings.save",
    meta: {
      batchSize: settings.batchSize,
      hasPostalAddress: Boolean(settings.postalAddress.trim()),
      hasUnsubscribeMailto: Boolean(mailto),
      trackOpensByDefault: settings.trackOpensByDefault,
      trackClicksByDefault: settings.trackClicksByDefault,
    },
  });

  revalidatePath("/marketing/settings");
  revalidatePath("/marketing");
  return { ok: true };
}

/**
 * Save the email signature, and nothing else.
 *
 * The rest of the settings are taken from what is stored, for the same
 * reason the main save takes the signature from storage: two forms on
 * one page must not be able to undo each other.
 */
export async function saveSignatureAction(input: unknown): Promise<Result> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to change the signature." };
  }

  const parsed = SignatureSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${describePath(first.path)}: ${first.message}`
        : "That signature could not be saved.",
    };
  }

  const stored = await currentSettings();
  await repos().settings.save({ ...stored, signature: parsed.data }, broker.id);

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "mailflow.signature.save",
    meta: {
      awards: parsed.data.awards.length,
      brokersWithPhotos: Object.values(parsed.data.brokers).filter((b) => b.photoUrl).length,
      hasInstagram: Boolean(parsed.data.instagramUrl),
      hasLinkedIn: Boolean(parsed.data.linkedinUrl),
    },
  });

  revalidatePath("/marketing/settings");
  return { ok: true };
}

/** "awards.2.imageUrl" -> "Award 3 image", so the error names a field
 *  the broker can see rather than a path. */
function describePath(path: PropertyKey[]): string {
  const [head, index, field] = path.map(String);
  if (head === "awards") return `Award ${Number(index) + 1} ${field === "alt" ? "description" : "image"}`;
  if (head === "brokers") return `${index}'s ${field === "photoUrl" ? "photo" : "title"}`;
  const names: Record<string, string> = {
    websiteUrl: "Website",
    instagramUrl: "Instagram profile",
    instagramIconUrl: "Instagram icon",
    linkedinUrl: "LinkedIn profile",
    linkedinIconUrl: "LinkedIn icon",
    bookingLabel: "Booking link words",
    signOff: "Sign-off",
    disclaimer: "Confidentiality note",
  };
  return names[head] ?? head;
}

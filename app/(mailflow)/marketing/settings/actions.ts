"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { MailflowSettingsSchema } from "@/lib/mailflow/settings";

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

  await repos().settings.save({ ...settings, unsubscribeMailto: mailto }, broker.id);

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

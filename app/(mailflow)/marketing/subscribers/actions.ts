"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";

/**
 * Tagging.
 *
 * Tags are keyed on the email address, because a Mailflow contact is
 * derived from a settlement or a live deal rather than stored as a row
 * of its own — the address is the only identity that survives across
 * both. It is normalised here, once, so the store never holds two
 * spellings of the same person.
 *
 * These return void rather than a result object because the table calls
 * them optimistically from a transition. A failure surfaces as the tag
 * simply not appearing after the refresh, which is the honest outcome:
 * there is nothing a broker could usefully do about it mid-click.
 */

/** Longer than this is a note, not a label, and it will not fit a chip. */
const MAX_TAG_LENGTH = 40;

function normaliseEmails(emails: string[]): string[] {
  const out = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email) out.add(email);
  }
  return [...out];
}

export async function tagContactsAction(
  emails: string[],
  tag: string,
): Promise<void> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return;

  const label = tag.trim().slice(0, MAX_TAG_LENGTH);
  if (!label) return;

  const targets = normaliseEmails(emails);
  if (targets.length === 0) return;

  /* Reuse the existing spelling of a tag that already differs only by
     case. Otherwise "Investor" and "investor" become two rows in the
     filter list, both of which look right and each of which selects
     half the group. */
  const existing = await repos().contactTag.counts();
  const match = existing.find(
    (t) => t.tag.toLowerCase() === label.toLowerCase(),
  );
  const canonical = match?.tag ?? label;

  const added = await repos().contactTag.add(targets, canonical, broker.id);

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "contact.tag",
    meta: { tag: canonical, requested: targets.length, added },
  });
  revalidatePath("/marketing/subscribers");
}

export async function untagContactsAction(
  emails: string[],
  tag: string,
): Promise<void> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return;

  const targets = normaliseEmails(emails);
  if (targets.length === 0) return;

  const removed = await repos().contactTag.remove(targets, tag);

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "contact.untag",
    meta: { tag, requested: targets.length, removed },
  });
  revalidatePath("/marketing/subscribers");
}

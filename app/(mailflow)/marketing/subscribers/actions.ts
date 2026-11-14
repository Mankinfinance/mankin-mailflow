"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { buildHistoryEvents } from "@/lib/campaigns/subscribers";
import { isCalendarDate, isEmail } from "@/lib/contacts-import";
import { currentSettings } from "@/lib/mailflow/current-settings";
import { TEAM } from "@/lib/team";
import type { NewMarketingContact } from "@/lib/db/schema";

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

/**
 * One contact's sequence emails, enquiries and survey answers, for
 * their panel. Dates go over the wire as ISO strings.
 */
export async function contactHistoryAction(
  email: string,
): Promise<
  | {
      ok: true;
      events: Array<{ kind: string; label: string; detail: string; at: string }>;
      /** Key dates by field id, YYYY-MM-DD. */
      dates: Record<string, string>;
    }
  | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required." };
  }
  const address = String(email ?? "").trim().toLowerCase().slice(0, 320);
  if (!address.includes("@")) return { ok: false, error: "That isn't an email address." };

  const [sends, submissions, responses, automations, forms, surveys, dates] = await Promise.all([
    repos().automation.sendsForEmail(address),
    repos().form.submissionsForEmail(address),
    repos().survey.responsesForEmail(address),
    repos().automation.list(),
    repos().form.list(),
    repos().survey.list(),
    repos().contactDate.forEmail(address),
  ]);
  const events = buildHistoryEvents({
    sends,
    automationNames: new Map(automations.map((a) => [a.id, a.name])),
    submissions,
    formNames: new Map(forms.map((f) => [f.id, f.name])),
    responses,
    surveyNames: new Map(surveys.map((s) => [s.id, s.name])),
  });
  return { ok: true, events: events.map((e) => ({ ...e, at: e.at.toISOString() })), dates };
}

/* -------------------------------------------------------------------------- */
/* Mailflow's own list                                                        */
/* -------------------------------------------------------------------------- */

export interface AddContactsResult {
  ok: true;
  added: number;
  /** Already on your list: left exactly as they were. */
  alreadyOnList: number;
  /** On the do-not-market register: added, but they stay unsubscribed. */
  suppressed: number;
  /** Rows the server refused (no valid address). */
  rejected: number;
  /** Key dates set from the file. */
  datesSet: number;
}

/**
 * Add people to Mailflow's own list, one by hand or a whole import.
 *
 * Every add carries a note of how we have permission to email them:
 * the Spam Act's first question, and the one nobody can answer about
 * an old spreadsheet a year later unless it was written down now.
 * Someone on the do-not-market register is still added (so the list is
 * complete) but stays unsubscribed: an import can never undo an opt-out.
 */
export async function addContactsAction(input: {
  rows: Array<{ email: string; name?: string; phone?: string; dates?: Record<string, string> }>;
  consentNote: string;
  brokerId: string;
  origin: "manual" | "import";
}): Promise<AddContactsResult | { ok: false; error: string }> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to add contacts." };
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: "There's nobody to add." };
  }
  if (input.rows.length > 5000) {
    return { ok: false, error: "Import up to 5,000 at a time." };
  }
  const consentNote = String(input.consentNote ?? "").replace(/\s+/g, " ").trim();
  if (consentNote.length < 5) {
    return { ok: false, error: "Say how you have permission to email them, e.g. \"Signed up at the March seminar\"." };
  }
  if (consentNote.length > 300) {
    return { ok: false, error: "Keep the permission note under 300 characters." };
  }
  if (!TEAM.some((m) => m.id === input.brokerId)) {
    return { ok: false, error: "Choose whose contacts these are." };
  }
  const origin = input.origin === "import" ? "import" : "manual";

  const seen = new Set<string>();
  const clean: NewMarketingContact[] = [];
  let rejected = 0;
  for (const r of input.rows) {
    const email = String(r?.email ?? "").trim().toLowerCase();
    if (!isEmail(email) || email.length > 254) {
      rejected += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    clean.push({
      email,
      name: String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      phone: String(r.phone ?? "").trim().slice(0, 40),
      brokerId: input.brokerId,
      origin,
      consentNote,
      createdBy: broker.id,
    });
  }
  if (clean.length === 0) {
    return { ok: false, error: "None of those are valid email addresses." };
  }

  const added = await repos().marketingContact.addMany(clean);

  /* Dates from the file go on everyone in it, including people already
     on the list: a spreadsheet of fixed-rate expiries is exactly how
     these arrive. Only fields that exist and dates that are real. */
  const { dateFields } = await currentSettings();
  const knownFields = new Set(dateFields.map((f) => f.id));
  let datesSet = 0;
  const done = new Set<string>();
  for (const r of input.rows) {
    const email = String(r?.email ?? "").trim().toLowerCase();
    if (!seen.has(email) || done.has(email) || !r.dates || typeof r.dates !== "object") continue;
    done.add(email);
    for (const [fieldId, value] of Object.entries(r.dates).slice(0, 12)) {
      if (!knownFields.has(fieldId) || typeof value !== "string" || !isCalendarDate(value)) continue;
      await repos().contactDate.set(email, fieldId, value, broker.id);
      datesSet += 1;
    }
  }
  const suppressed = await repos().campaign.suppressedAmong(added);

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: origin === "import" ? "contacts.import" : "contacts.add",
    meta: {
      added: added.length,
      alreadyOnList: clean.length - added.length,
      rejected,
      suppressed: suppressed.size,
      datesSet,
      brokerId: input.brokerId,
      consentNote,
    },
  });
  revalidatePath("/marketing/subscribers");
  return {
    ok: true,
    added: added.length,
    alreadyOnList: clean.length - added.length,
    suppressed: suppressed.size,
    rejected,
    datesSet,
  };
}

/** Take someone off Mailflow's own list. Their tags, history and any
 *  opt-out stay; they just stop being a contact. */
export async function removeFromListAction(email: string): Promise<{ ok: boolean }> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return { ok: false };
  const address = String(email ?? "").trim().toLowerCase();
  if (!address) return { ok: false };
  await repos().marketingContact.remove(address);
  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "contacts.remove",
    meta: { email: address },
  });
  revalidatePath("/marketing/subscribers");
  return { ok: true };
}

/**
 * Set or clear one of a contact's key dates (Settings > Key dates). A
 * date-started sequence reads these.
 */
export async function setContactDateAction(
  email: string,
  fieldId: string,
  date: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return { ok: false, error: "Admin access required." };
  const address = String(email ?? "").trim().toLowerCase();
  if (!isEmail(address)) return { ok: false, error: "That isn't an email address." };
  const { dateFields } = await currentSettings();
  if (!dateFields.some((f) => f.id === fieldId)) return { ok: false, error: "That date isn't in Settings." };
  if (date !== null && !isCalendarDate(date)) return { ok: false, error: "Use a real date." };

  await repos().contactDate.set(address, fieldId, date, broker.id);
  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "contacts.set-date",
    meta: { email: address, fieldId, date },
  });
  return { ok: true };
}

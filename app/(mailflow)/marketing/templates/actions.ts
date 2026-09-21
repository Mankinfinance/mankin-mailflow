"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { defaultAudienceFilter } from "@/lib/campaigns/types";
import {
  TemplateConfigSchema,
  builtInTemplate,
  type TemplateCategory,
} from "@/lib/templates/types";

/**
 * Server actions behind the templates surface.
 *
 * Admin-gated like campaigns. A template is not itself a send, but it
 * is the wording the firm's name goes out under, and one edited badly
 * propagates into every campaign started from it afterwards.
 */

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const DENIED = "Admin access required to manage templates.";

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return { ok: false, error: DENIED };
  return { ok: true, brokerId: broker.id };
}

export interface SaveTemplateInput {
  /** Omitted for a new template. */
  id?: string;
  name: string;
  subject: string;
  body: string;
  category: TemplateCategory;
  description: string;
}

export async function saveTemplateAction(
  input: SaveTemplateInput,
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the template a name." };
  if (!input.body.trim()) {
    return { ok: false, error: "A template with no body is not worth saving." };
  }

  const config = TemplateConfigSchema.parse({
    subject: input.subject,
    body: input.body,
    category: input.category,
    description: input.description.trim(),
  });

  if (input.id) {
    const existing = await repos().emailTemplate.get(input.id);
    if (!existing) return { ok: false, error: "That template no longer exists." };
    await repos().emailTemplate.update(input.id, { name, config });
    await auditLog({
      actor: { type: "broker", id: auth.brokerId },
      action: "template.update",
      meta: { templateId: input.id, name },
    });
    revalidatePath("/marketing/templates");
    return { ok: true, id: input.id };
  }

  const created = await repos().emailTemplate.create({
    name,
    config,
    createdBy: auth.brokerId,
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "template.create",
    meta: { templateId: created.id, name },
  });
  revalidatePath("/marketing/templates");
  return { ok: true, id: created.id };
}

export async function deleteTemplateAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const existing = await repos().emailTemplate.get(id);
  if (!existing) return { ok: true };

  await repos().emailTemplate.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "template.delete",
    meta: { templateId: id, name: existing.name },
  });
  revalidatePath("/marketing/templates");
  return { ok: true };
}

/**
 * Start a campaign from a template, saved or built-in.
 *
 * The template is copied, not referenced. A campaign that read its
 * wording from a template would change retroactively when the template
 * was edited — including, in the worst case, a campaign already
 * scheduled to send tonight.
 */
export async function startCampaignFromTemplateAction(args: {
  source: "saved" | "built-in";
  id: string;
}): Promise<Result<{ campaignId: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  let name: string;
  let subject: string;
  let body: string;

  if (args.source === "built-in") {
    const template = builtInTemplate(args.id);
    if (!template) return { ok: false, error: "That template no longer exists." };
    name = template.name;
    subject = template.subject;
    body = template.body;
  } else {
    const row = await repos().emailTemplate.get(args.id);
    if (!row) return { ok: false, error: "That template no longer exists." };
    const config = TemplateConfigSchema.safeParse(row.config);
    if (!config.success) {
      return { ok: false, error: "That template could not be read." };
    }
    name = row.name;
    subject = config.data.subject;
    body = config.data.body;
    await repos().emailTemplate.recordUse(row.id);
  }

  const campaign = await repos().campaign.create({
    name,
    subject,
    body,
    status: "draft",
    audience: defaultAudienceFilter(),
    fromBrokerId: auth.brokerId,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "campaign.create",
    meta: {
      campaignId: campaign.id,
      name,
      fromTemplate: args.id,
      templateSource: args.source,
    },
  });
  revalidatePath("/marketing/campaigns");
  revalidatePath("/marketing/templates");
  return { ok: true, campaignId: campaign.id };
}

/**
 * Save an existing campaign's wording as a template — the direction
 * brokers actually work in. Most templates start life as an email
 * someone wrote once and then wished they still had.
 */
export async function saveCampaignAsTemplateAction(args: {
  campaignId: string;
  name: string;
  category: TemplateCategory;
  description: string;
}): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const campaign = await repos().campaign.get(args.campaignId);
  if (!campaign) return { ok: false, error: "That campaign no longer exists." };

  return saveTemplateAction({
    name: args.name || campaign.name,
    subject: campaign.subject,
    body: campaign.body,
    category: args.category,
    description: args.description,
  });
}

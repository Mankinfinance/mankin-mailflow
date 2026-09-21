"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import {
  AUTOMATION_TEMPLATES,
  AutomationFlowSchema,
  emptyFlow,
} from "@/lib/automations/types";
import { validateFlow } from "@/lib/automations/engine";

/**
 * Server actions for the automations surface. Admin-gated like the rest
 * of Mailflow: a live sequence mails people for months without anyone
 * pressing send, which is more consequence than a single campaign, not
 * less.
 */

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to manage automations." };
  }
  return { ok: true, brokerId: broker.id };
}

export async function createAutomationAction(
  templateId: string | null,
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const template = templateId
    ? AUTOMATION_TEMPLATES.find((t) => t.id === templateId)
    : null;
  if (templateId && !template) {
    return { ok: false, error: "That template no longer exists." };
  }

  const automation = await repos().automation.create({
    name: template?.name ?? "New sequence",
    status: "draft",
    flow: template?.flow ?? emptyFlow(),
    fromBrokerId: auth.brokerId,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "automation.create",
    meta: { automationId: automation.id, template: templateId },
  });
  revalidatePath("/marketing/automations");
  return { ok: true, id: automation.id };
}

/**
 * Turn a sequence on.
 *
 * Validated first, because a live automation with a broken pointer or an
 * empty send would fail quietly in a cron at 2am rather than in front of
 * whoever turned it on.
 */
export async function activateAutomationAction(
  id: string,
): Promise<Result<{ problems?: string[] }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const automation = await repos().automation.get(id);
  if (!automation) return { ok: false, error: "Sequence not found." };

  const parsed = AutomationFlowSchema.safeParse(automation.flow);
  if (!parsed.success) {
    return { ok: false, error: "This sequence could not be read." };
  }
  const problems = validateFlow(parsed.data);
  if (problems.length > 0) {
    return { ok: false, error: problems.join(" ") };
  }

  await repos().automation.update(id, {
    status: "live",
    activatedAt: automation.activatedAt ?? new Date(),
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "automation.activate",
    meta: { automationId: id, name: automation.name },
  });
  revalidatePath(`/marketing/automations/${id}`);
  revalidatePath("/marketing/automations");
  return { ok: true };
}

/**
 * Stop new people entering. Contacts already partway through finish the
 * sequence — cutting them off mid-flow would leave someone who received
 * "I will follow up" never followed up.
 */
export async function pauseAutomationAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const automation = await repos().automation.get(id);
  if (!automation) return { ok: false, error: "Sequence not found." };

  await repos().automation.update(id, { status: "paused" });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "automation.pause",
    meta: { automationId: id },
  });
  revalidatePath(`/marketing/automations/${id}`);
  revalidatePath("/marketing/automations");
  return { ok: true };
}

export async function renameAutomationAction(
  id: string,
  name: string,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the sequence a name." };
  await repos().automation.update(id, { name: trimmed });
  revalidatePath(`/marketing/automations/${id}`);
  return { ok: true };
}

export async function deleteAutomationAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const automation = await repos().automation.get(id);
  if (!automation) return { ok: false, error: "Sequence not found." };
  if (automation.status === "live") {
    return {
      ok: false,
      error: "Pause the sequence before deleting it, so nobody is cut off mid-flow.",
    };
  }

  await repos().automation.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "automation.delete",
    meta: { automationId: id, name: automation.name },
  });
  revalidatePath("/marketing/automations");
  return { ok: true };
}

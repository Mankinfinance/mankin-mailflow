"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import {
  FORM_TEMPLATES,
  FormConfigSchema,
  emptyFormConfig,
  type FormType,
} from "@/lib/forms/types";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to manage forms." };
  }
  return { ok: true, brokerId: broker.id };
}

export async function createFormAction(input: {
  name: string;
  type: FormType;
  templateId: string | null;
}): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the form a name." };

  const template = input.templateId
    ? FORM_TEMPLATES.find((t) => t.id === input.templateId)
    : null;

  /* A template carries a placeholder broker; the deal has to belong to
     whoever set the form up, or nobody's queue picks the enquiry up. */
  const config = template
    ? FormConfigSchema.parse({
        ...template.config,
        destination:
          template.config.destination.kind === "pipeline"
            ? { ...template.config.destination, brokerId: auth.brokerId }
            : template.config.destination,
      })
    : emptyFormConfig(auth.brokerId);

  const form = await repos().form.create({
    name,
    type: template?.type ?? input.type,
    status: "draft",
    config,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "form.create",
    meta: { formId: form.id, name, template: input.templateId },
  });
  revalidatePath("/marketing/forms");
  return { ok: true, id: form.id };
}

export async function saveFormAction(input: {
  id: string;
  name: string;
  config: unknown;
}): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = FormConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: "That form configuration isn't valid." };
  }
  if (
    !parsed.data.fields.includes("email") &&
    !parsed.data.fields.includes("phone")
  ) {
    return {
      ok: false,
      error:
        "Ask for an email or a phone number — otherwise an enquiry arrives with no way to answer it.",
    };
  }

  await repos().form.update(input.id, {
    name: input.name.trim(),
    config: parsed.data,
  });
  revalidatePath(`/marketing/forms/${input.id}`);
  return { ok: true };
}

/** Publish. A live form is reachable by anyone with the link. */
export async function publishFormAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const form = await repos().form.get(id);
  if (!form) return { ok: false, error: "Form not found." };

  const parsed = FormConfigSchema.safeParse(form.config);
  if (!parsed.success) {
    return { ok: false, error: "This form is not configured correctly." };
  }

  await repos().form.update(id, { status: "live" });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "form.publish",
    meta: { formId: id, name: form.name },
  });
  revalidatePath(`/marketing/forms/${id}`);
  revalidatePath("/marketing/forms");
  return { ok: true };
}

export async function pauseFormAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  await repos().form.update(id, { status: "paused" });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "form.pause",
    meta: { formId: id },
  });
  revalidatePath(`/marketing/forms/${id}`);
  revalidatePath("/marketing/forms");
  return { ok: true };
}

export async function deleteFormAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const form = await repos().form.get(id);
  if (!form) return { ok: false, error: "Form not found." };
  if (form.status === "live") {
    return {
      ok: false,
      error: "Pause the form first — it is currently reachable on the website.",
    };
  }

  await repos().form.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "form.delete",
    meta: { formId: id, name: form.name },
  });
  revalidatePath("/marketing/forms");
  return { ok: true };
}

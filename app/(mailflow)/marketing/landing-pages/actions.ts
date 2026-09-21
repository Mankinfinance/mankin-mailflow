"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import {
  PAGE_TEMPLATES,
  PageConfigSchema,
  emptyPageConfig,
  isReservedSlug,
  isValidSlug,
  slugify,
  validatePage,
} from "@/lib/sites/types";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to manage pages." };
  }
  return { ok: true, brokerId: broker.id };
}

/**
 * Find a slug nobody else is using.
 *
 * Appends -2, -3 rather than refusing: two pages called "Refinance
 * health check" a year apart is normal, and making the broker invent a
 * unique name is a worse experience than a numbered address.
 */
async function availableSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "page";
  let candidate = root;
  for (let n = 2; n < 100; n++) {
    const existing = await repos().landingPage.bySlug(candidate);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

export async function createPageAction(
  templateId: string | null,
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const template = templateId
    ? PAGE_TEMPLATES.find((t) => t.id === templateId)
    : null;
  if (templateId && !template) {
    return { ok: false, error: "That template no longer exists." };
  }

  const name = template?.name ?? "New page";
  const slug = await availableSlug(template?.slug ?? name);

  const page = await repos().landingPage.create({
    name,
    slug,
    status: "draft",
    config: template ? PageConfigSchema.parse(template.config) : emptyPageConfig(),
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "page.create",
    meta: { pageId: page.id, slug, template: templateId },
  });
  revalidatePath("/marketing/landing-pages");
  return { ok: true, id: page.id };
}

export async function savePageAction(input: {
  id: string;
  name: string;
  slug: string;
  config: unknown;
}): Promise<Result<{ slug: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = PageConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: "That page could not be saved." };
  }

  const slug = slugify(input.slug);
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: "The web address needs to be lower-case words joined by hyphens.",
    };
  }
  if (isReservedSlug(slug)) {
    return { ok: false, error: `"${slug}" is reserved by the app.` };
  }

  const clash = await repos().landingPage.bySlug(slug);
  if (clash && clash.id !== input.id) {
    return { ok: false, error: `Another page already lives at /p/${slug}.` };
  }

  await repos().landingPage.update(input.id, {
    name: input.name.trim() || "Untitled page",
    slug,
    config: parsed.data,
  });
  revalidatePath(`/marketing/landing-pages/${input.id}`);
  return { ok: true, slug };
}

/** Publish. Validated first — a published page with a form-shaped hole
 *  in it is worse than an unpublished one. */
export async function publishPageAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const page = await repos().landingPage.get(id);
  if (!page) return { ok: false, error: "Page not found." };

  const parsed = PageConfigSchema.safeParse(page.config);
  if (!parsed.success) {
    return { ok: false, error: "This page could not be read." };
  }
  const problems = validatePage(parsed.data);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  await repos().landingPage.update(id, {
    status: "published",
    publishedAt: page.publishedAt ?? new Date(),
  });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "page.publish",
    meta: { pageId: id, slug: page.slug },
  });
  revalidatePath(`/marketing/landing-pages/${id}`);
  revalidatePath("/marketing/landing-pages");
  return { ok: true };
}

export async function unpublishPageAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  await repos().landingPage.update(id, { status: "draft" });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "page.unpublish",
    meta: { pageId: id },
  });
  revalidatePath(`/marketing/landing-pages/${id}`);
  revalidatePath("/marketing/landing-pages");
  return { ok: true };
}

export async function deletePageAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const page = await repos().landingPage.get(id);
  if (!page) return { ok: false, error: "Page not found." };
  if (page.status === "published") {
    return {
      ok: false,
      error: "Unpublish the page first — it is currently live on the web.",
    };
  }

  await repos().landingPage.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "page.delete",
    meta: { pageId: id, slug: page.slug },
  });
  revalidatePath("/marketing/landing-pages");
  return { ok: true };
}

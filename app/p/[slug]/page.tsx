import { notFound } from "next/navigation";
import { repos } from "@/lib/db/repos";
import { PageConfigSchema } from "@/lib/sites/types";
import { FormConfigSchema, type FormConfig } from "@/lib/forms/types";
import { MANKIN_CREDIT_LINE } from "@/lib/email-signature";
import { PageBlocks } from "@/components/sites/PageBlocks";
import { PageViewBeacon } from "@/components/sites/PageViewBeacon";

/**
 * A published landing page, served at /p/<slug>.
 *
 * Public, no session, no app shell — the same posture as the hosted
 * form and the unsubscribe page. A draft 404s rather than rendering:
 * an unfinished page reachable by anyone who guesses the slug is worse
 * than a missing one.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await repos().landingPage.bySlug(slug);
  if (!page || page.status !== "published") return { title: "Mankin Finance" };

  const parsed = PageConfigSchema.safeParse(page.config);
  return {
    title: parsed.success && parsed.data.metaTitle
      ? parsed.data.metaTitle
      : `${page.name} · Mankin Finance`,
    description: parsed.success ? parsed.data.metaDescription : undefined,
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await repos().landingPage.bySlug(slug);
  if (!page || page.status !== "published") notFound();

  const parsed = PageConfigSchema.safeParse(page.config);
  if (!parsed.success) notFound();

  /* Resolve the forms the page embeds. Only live ones: a paused form
     should stop collecting everywhere it appears, not just on its own
     hosted page. */
  const formIds = [
    ...new Set(
      parsed.data.blocks
        .filter((b) => b.kind === "form" && b.formId)
        .map((b) => (b.kind === "form" ? b.formId : "")),
    ),
  ];
  const forms: Record<string, { id: string; config: FormConfig } | undefined> = {};
  for (const id of formIds) {
    const form = await repos().form.get(id);
    if (!form || form.status !== "live") continue;
    const formConfig = FormConfigSchema.safeParse(form.config);
    if (formConfig.success) forms[id] = { id: form.id, config: formConfig.data };
  }

  return (
    <main className="min-h-screen bg-paper">
      <PageViewBeacon pageId={page.id} />

      <div className="mx-auto max-w-[720px] px-6 py-12">
        <div className="mb-10">
          <div
            className="text-[22px] leading-none text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Mankin.
          </div>
          <div
            className="mt-1 text-[8.5px] font-bold text-ink-mute"
            style={{ letterSpacing: "0.34em" }}
          >
            FINANCE
          </div>
        </div>

        <PageBlocks blocks={parsed.data.blocks} forms={forms} pageId={page.id} />

        <footer className="mt-14 border-t border-hairline pt-5">
          <p
            className="mono text-[9.5px] leading-relaxed"
            style={{ color: "var(--color-ink-placeholder)" }}
          >
            {MANKIN_CREDIT_LINE}
          </p>
        </footer>
      </div>
    </main>
  );
}

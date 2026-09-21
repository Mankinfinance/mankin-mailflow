import { notFound } from "next/navigation";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import { PageEditor } from "@/components/mailflow/PageEditor";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { portalBaseUrl } from "@/lib/portal-link";
import { PageConfigSchema, validatePage } from "@/lib/sites/types";
import { FormConfigSchema } from "@/lib/forms/types";

export const metadata = { title: "Page · Mailflow" };

export default async function LandingPageEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broker = await currentBroker();

  const page = await repos().landingPage.get(id);
  if (!page) notFound();

  const parsed = PageConfigSchema.safeParse(page.config);
  if (!parsed.success) notFound();

  /* Only live forms can be embedded: a paused form should stop
     collecting everywhere it appears, not just on its own page. */
  const allForms = await repos().form.list({ statuses: ["live"] });
  const forms = allForms.flatMap((form) => {
    const config = FormConfigSchema.safeParse(form.config);
    return config.success
      ? [{ id: form.id, name: form.name, config: config.data }]
      : [];
  });

  const problems = validatePage(parsed.data);

  return (
    <>
      <MailflowNav active="landing-pages" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
          record={{
            name: page.name,
            status: page.status,
            backHref: "/marketing/landing-pages",
          }}
        />
        <MailflowContent>
          <PageTitle
            title={page.name}
            context={`${page.views} ${page.views === 1 ? "visit" : "visits"}${
              page.publishedAt
                ? ` · published ${page.publishedAt.toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}`
                : " · not published yet"
            }`}
          />

          {problems.length > 0 && page.status !== "published" && (
            <div
              className="mb-4 rounded-md border px-3.5 py-2.5"
              style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
            >
              <p className="text-[12px] font-semibold" style={{ color: "#8a3733" }}>
                {problems.length === 1
                  ? "One thing to fix before publishing"
                  : `${problems.length} things to fix before publishing`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {problems.map((p) => (
                  <li key={p} className="text-[11.5px]" style={{ color: "#8a3733" }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <PageEditor
            page={{
              id: page.id,
              name: page.name,
              slug: page.slug,
              status: page.status,
              config: parsed.data,
            }}
            forms={forms}
            appUrl={portalBaseUrl()}
          />
        </MailflowContent>
      </div>
    </>
  );
}

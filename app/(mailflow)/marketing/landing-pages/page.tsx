import Link from "next/link";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { PageTemplates } from "@/components/mailflow/PageTemplates";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { portalBaseUrl } from "@/lib/portal-link";

export const metadata = { title: "Landing pages · Mailflow" };

/**
 * Screen 7's other half — small published pages, each doing one job.
 *
 * Conversions are counted on the page an enquiry actually came through,
 * not on the form it used. A form embedded on three pages would
 * otherwise report the same total on all three, and an unpublished page
 * would claim enquiries that arrived somewhere else entirely.
 */
export default async function LandingPagesPage() {
  const broker = await currentBroker();
  const [pages, pageCounts] = await Promise.all([
    repos().landingPage.list(),
    repos().form.pageSubmissionCounts(),
  ]);

  const rows = pages.map((page) => {
    const conversions = pageCounts[page.id] ?? 0;
    return {
      page,
      conversions,
      rate: page.views > 0 ? (conversions / page.views) * 100 : null,
    };
  });

  const published = rows.filter((r) => r.page.status === "published").length;
  const base = portalBaseUrl();

  return (
    <>
      <MailflowNav
        active="landing-pages"
        footer={
          <p className="rounded-md border border-hairline bg-paper px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute">
            Pages embed a form from the Forms module, so an enquiry lands in
            the pipeline the same way wherever it came from.
          </p>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <PageTitle
            title="Landing pages"
            context={
              rows.length === 0
                ? "Nothing published yet"
                : `${published} published · ${rows.length} in total`
            }
          />

          {rows.length > 0 && (
            <Card padded={false} className="mb-[22px] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                    <Th>Page</Th>
                    <Th>Status</Th>
                    <Th align="right">Visits</Th>
                    <Th align="right">Enquiries</Th>
                    <Th align="right">Rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ page, conversions, rate }) => (
                    <tr
                      key={page.id}
                      className="mf-quiet border-t transition-colors hover:bg-paper-warm"
                      style={{ borderColor: "var(--color-hairline-softer)" }}
                    >
                      <td className="px-3.5 py-2.5">
                        <Link
                          href={`/marketing/landing-pages/${page.id}`}
                          className="block text-[12.5px] font-semibold text-brand-deep hover:underline"
                        >
                          {page.name}
                        </Link>
                        {page.status === "published" ? (
                          <a
                            href={`${base}/p/${page.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mono mt-0.5 block truncate text-[10.5px] text-ink-mute hover:underline"
                          >
                            /p/{page.slug}
                          </a>
                        ) : (
                          <span className="mono mt-0.5 block truncate text-[10.5px] text-ink-faint">
                            /p/{page.slug}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <PageStatusPill status={page.status} />
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-soft">
                        {page.views}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[12px] tabular-nums text-ink-soft">
                        {conversions}
                      </td>
                      <td
                        className="px-3.5 py-2.5 text-right text-[12px] font-semibold tabular-nums"
                        style={{
                          color:
                            rate === null
                              ? "var(--color-ink-zero)"
                              : "var(--color-ink)",
                        }}
                      >
                        {rate === null ? "—" : `${rate.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <section>
            <Eyebrow className="mb-1">
              {rows.length > 0 ? "Add another" : "Start with a template"}
            </Eyebrow>
            <p className="mb-4 max-w-[620px] text-[12.5px] text-ink-mute">
              Each template is a short page that explains one thing and then
              asks for the enquiry.
            </p>
            <PageTemplates />
          </section>
        </MailflowContent>
      </div>
    </>
  );
}

function PageStatusPill({ status }: { status: string }) {
  const tone =
    status === "published"
      ? { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4" }
      : { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" };
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ backgroundColor: tone.bg, color: tone.ink, borderColor: tone.line }}
    >
      {status}
    </span>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3.5 py-2 text-[10.5px] font-bold uppercase text-ink-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ letterSpacing: "0.12em" }}
    >
      {children}
    </th>
  );
}

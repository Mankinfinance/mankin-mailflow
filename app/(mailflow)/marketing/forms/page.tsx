import Link from "next/link";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { FormGallery } from "@/components/mailflow/FormGallery";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import {
  FORM_TYPE_BLURBS,
  FORM_TYPE_LABELS,
  FormConfigSchema,
  conversionRate,
  type FormType,
} from "@/lib/forms/types";

export const metadata = { title: "Forms · Mailflow" };

const TABS: Array<FormType | "all"> = ["all", "popup", "embedded", "promotion"];

/**
 * Screen 7 — the acquisition surfaces.
 *
 * The principle the page states up front: everything here writes into
 * the loan pipeline, not into a separate list. A form that only grows a
 * mailing list is a form nobody follows up.
 */
export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const active: FormType | "all" =
    type === "popup" || type === "embedded" || type === "promotion" ? type : "all";

  const broker = await currentBroker();
  const [forms, counts] = await Promise.all([
    repos().form.list(),
    repos().form.submissionCounts(),
  ]);

  const byType = (t: FormType) => forms.filter((f) => f.type === t).length;
  const visible =
    active === "all" ? forms : forms.filter((f) => f.type === active);

  return (
    <>
      <MailflowNav
        active="forms"
        footer={
          <p className="rounded-md border border-hairline bg-paper px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute">
            Every enquiry creates a deal in the pipeline, so it lands in
            somebody&apos;s queue rather than a list.
          </p>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent>
          <PageTitle
            title="Forms"
            context="Everything here writes into the loan pipeline, not into a separate list"
          />

          {/* Type tabs, with counts */}
          <div className="mb-5 flex items-center gap-1 border-b border-hairline">
            {TABS.map((tab) => {
              const count =
                tab === "all" ? forms.length : byType(tab as FormType);
              const isActive = tab === active;
              return (
                <Link
                  key={tab}
                  href={tab === "all" ? "/marketing/forms" : `/marketing/forms?type=${tab}`}
                  className="mf-quiet -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] transition-colors"
                  style={{
                    borderColor: isActive ? "#161461" : "transparent",
                    color: isActive ? "#161461" : "var(--color-ink-mute)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {tab === "all" ? "All forms" : FORM_TYPE_LABELS[tab as FormType]}
                  <span
                    className="rounded-full px-1.5 text-[10.5px] tabular-nums"
                    style={{
                      backgroundColor: isActive ? "#eaeefe" : "var(--color-paper-warm)",
                      color: isActive ? "#161461" : "var(--color-ink-faint)",
                    }}
                  >
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>

          {active !== "all" && (
            <p className="mb-4 max-w-[560px] text-[12px] text-ink-mute">
              {FORM_TYPE_BLURBS[active]}
            </p>
          )}

          {visible.length > 0 && (
            <div className="mb-[22px] grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((form) => {
                const parsed = FormConfigSchema.safeParse(form.config);
                const submissions = counts[form.id] ?? 0;
                const rate = conversionRate(submissions, form.views);
                return (
                  <Card key={form.id} className="flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/marketing/forms/${form.id}`}
                        className="text-[13.5px] font-semibold text-brand-deep hover:underline"
                      >
                        {form.name}
                      </Link>
                      <FormStatusPill status={form.status} />
                    </div>
                    <p className="mono mt-0.5 truncate text-[10.5px] text-ink-mute">
                      /f/{form.id.slice(0, 8)}
                    </p>

                    <div className="my-3 grid grid-cols-2 gap-3 border-y border-hairline py-2.5">
                      <div>
                        <Eyebrow>Submissions</Eyebrow>
                        <div className="text-[19px] font-semibold tabular-nums text-ink">
                          {submissions}
                        </div>
                      </div>
                      <div>
                        <Eyebrow>Conversion</Eyebrow>
                        <div
                          className="text-[19px] font-semibold tabular-nums"
                          style={{
                            color:
                              rate === null
                                ? "var(--color-ink-zero)"
                                : "var(--color-ink)",
                          }}
                        >
                          {rate === null ? "—" : `${rate.toFixed(1)}%`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11.5px] text-ink-mute">
                      Goes to
                      <span
                        className="rounded-md px-1.5 py-0.5 font-semibold"
                        style={
                          parsed.success &&
                          parsed.data.destination.kind === "pipeline"
                            ? { backgroundColor: "#eef1fb", color: "#4151a8" }
                            : { backgroundColor: "#f3eee4", color: "#6a5b3c" }
                        }
                      >
                        {parsed.success &&
                        parsed.data.destination.kind === "pipeline"
                          ? "The loan pipeline"
                          : "Enquiry record only"}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <section>
            <Eyebrow className="mb-1">
              {visible.length > 0 ? "Add another" : "Start with a template"}
            </Eyebrow>
            <p className="mb-4 max-w-[620px] text-[12.5px] text-ink-mute">
              Each of these asks for as little as it can and lands in
              somebody&apos;s queue.
            </p>
            <FormGallery activeType={active} />
          </section>
        </MailflowContent>
      </div>
    </>
  );
}

export function FormStatusPill({ status }: { status: string }) {
  const tone =
    status === "live"
      ? { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4" }
      : status === "paused"
        ? { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd" }
        : { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" };
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ backgroundColor: tone.bg, color: tone.ink, borderColor: tone.line }}
    >
      {status}
    </span>
  );
}

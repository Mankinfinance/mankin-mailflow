import { notFound } from "next/navigation";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { FormEditor } from "@/components/mailflow/FormEditor";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { TEAM } from "@/lib/team";
import { STAGES } from "@/lib/clients/salestrekker/types";
import { portalBaseUrl } from "@/lib/portal-link";
import {
  FORM_TYPE_LABELS,
  FormConfigSchema,
  conversionRate,
  type FormType,
} from "@/lib/forms/types";

export const metadata = { title: "Form · Mailflow" };

export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broker = await currentBroker();

  const form = await repos().form.get(id);
  if (!form) notFound();

  const parsed = FormConfigSchema.safeParse(form.config);
  if (!parsed.success) notFound();

  const submissions = await repos().form.listSubmissions(form.id, 50);
  const rate = conversionRate(submissions.length, form.views);

  return (
    <>
      <MailflowNav active="forms" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
          record={{
            name: form.name,
            status: form.status,
            backHref: "/marketing/forms",
          }}
        />
        <MailflowContent>
          <PageTitle
            title={form.name}
            context={`${FORM_TYPE_LABELS[form.type as FormType]} · ${form.views} ${
              form.views === 1 ? "view" : "views"
            } · ${submissions.length} ${
              submissions.length === 1 ? "enquiry" : "enquiries"
            }${rate === null ? "" : ` · ${rate.toFixed(1)}% conversion`}`}
          />

          <FormEditor
            form={{
              id: form.id,
              name: form.name,
              type: form.type as FormType,
              status: form.status,
              config: parsed.data,
            }}
            brokers={TEAM.filter((m) => m.email).map((m) => ({
              id: m.id,
              name: m.name,
            }))}
            stages={STAGES.map((s) => ({ id: s.id, label: s.shortLabel }))}
            appUrl={portalBaseUrl()}
          />

          {submissions.length > 0 && (
            <Card className="mt-[22px]" padded={false}>
              <div className="px-3.5 pt-3.5">
                <Eyebrow>Enquiries</Eyebrow>
              </div>
              <table className="mt-2.5 w-full">
                <thead>
                  <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                    <Th>Name</Th>
                    <Th>Contact</Th>
                    <Th>Became</Th>
                    <Th align="right">When</Th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr
                      key={s.id}
                      className="border-t"
                      style={{ borderColor: "var(--color-hairline-softer)" }}
                    >
                      <td className="px-3.5 py-2 text-[12px] font-semibold text-ink">
                        {s.name || "—"}
                      </td>
                      <td className="px-3.5 py-2">
                        <span className="mono block text-[11px] text-ink-soft">
                          {s.email || s.phone}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 text-[11.5px]">
                        {s.dealId ? (
                          <span style={{ color: "#2f6f4a" }}>A deal in the pipeline</span>
                        ) : s.error ? (
                          <span style={{ color: "#a3423e" }} title={s.error}>
                            Needs picking up by hand
                          </span>
                        ) : (
                          <span className="text-ink-mute">Enquiry record</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[11.5px] tabular-nums text-ink-mute">
                        {s.submittedAt.toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </MailflowContent>
      </div>
    </>
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

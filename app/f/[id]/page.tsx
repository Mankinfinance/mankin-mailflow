import { notFound } from "next/navigation";
import { repos } from "@/lib/db/repos";
import { FormConfigSchema } from "@/lib/forms/types";
import { MANKIN_CREDIT_LINE } from "@/lib/email-signature";
import { PublicForm } from "@/components/forms/PublicForm";

/**
 * The hosted version of a form — what the embed snippet points at, and
 * what a link in an email or a social post can open directly.
 *
 * Public, no session, no app shell. Same posture as the unsubscribe
 * page: someone arriving here has no account and should not need one.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const form = await repos().form.get(id);
  const parsed = form ? FormConfigSchema.safeParse(form.config) : null;
  return {
    title: parsed?.success
      ? `${parsed.data.headline} · Mankin Finance`
      : "Mankin Finance",
  };
}

export default async function HostedFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const form = await repos().form.get(id);
  if (!form) notFound();

  const parsed = FormConfigSchema.safeParse(form.config);
  if (!parsed.success) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <div
        className="w-full max-w-[420px] rounded-2xl border border-hairline bg-surface px-[26px] py-7"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="mb-5 border-b border-hairline pb-4 text-center">
          <div
            className="text-[21px] leading-none text-brand-deep"
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

        {form.status === "live" ? (
          <PublicForm formId={form.id} config={parsed.data} />
        ) : (
          <p className="text-center text-[13px] text-ink-mute">
            This form is not accepting enquiries at the moment. Email{" "}
            <a
              className="font-semibold text-brand underline"
              href="mailto:support@mankinfinance.com"
            >
              support@mankinfinance.com
            </a>{" "}
            and we will help directly.
          </p>
        )}

        <p
          className="mono mt-6 border-t border-hairline pt-3.5 text-center text-[9px] leading-relaxed"
          style={{ color: "var(--color-ink-placeholder)" }}
        >
          {MANKIN_CREDIT_LINE}
        </p>
      </div>
    </main>
  );
}

import { verifyTrackingToken } from "@/lib/campaigns/tracking";
import { MANKIN_CREDIT_LINE } from "@/lib/email-signature";
import { UnsubscribeForm } from "@/components/campaigns/UnsubscribeForm";

/**
 * Unsubscribe landing page. Reached from the footer of every campaign,
 * so it must render for someone with no session, on any device, months
 * after the email was sent — hence no app shell, and nothing on the page
 * that assumes the reader knows what LoanFlow is.
 *
 * The page confirms rather than acting on load: mail scanners and
 * link-preview bots fetch every URL in an email, and acting on GET would
 * opt people out who never clicked anything.
 *
 * The masthead, the serif heading and the service-correspondence
 * explanation are not legally required. They are here because this page
 * discharges an obligation under the Spam Act 2003, and it should look
 * like the firm honouring it willingly rather than complying minimally.
 */

export const metadata = {
  title: "Unsubscribe · Mankin Finance",
};

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verified = await verifyTrackingToken(token, "unsubscribe");

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <div
        className="w-full max-w-[390px] rounded-2xl border border-hairline bg-surface px-[26px] py-7"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="mb-5 border-b border-hairline pb-4 text-center">
          <div
            className="text-[23px] leading-none text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Mankin.
          </div>
          <div
            className="mt-1 text-[9px] font-bold text-ink-mute"
            style={{ letterSpacing: "0.34em" }}
          >
            FINANCE
          </div>
        </div>

        {verified.ok ? (
          <UnsubscribeForm token={token} email={verified.claims.em} />
        ) : (
          <>
            <h1
              className="mb-2.5 text-[23px] text-brand-deep"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                lineHeight: 1.25,
              }}
            >
              This unsubscribe link isn&apos;t valid
            </h1>
            <p className="text-[13px] leading-relaxed text-ink-mute">
              The link may have been altered on its way to you. Reply to the
              email you received, or write to{" "}
              <a
                className="font-semibold text-brand underline"
                href="mailto:support@mankinfinance.com"
              >
                support@mankinfinance.com
              </a>
              , and we will take you off the list by hand.
            </p>
          </>
        )}

        <p
          className="mono mt-6 border-t border-hairline pt-3.5 text-center text-[9.5px] leading-relaxed"
          style={{ color: "var(--color-ink-placeholder)" }}
        >
          {MANKIN_CREDIT_LINE}
        </p>
      </div>
    </main>
  );
}

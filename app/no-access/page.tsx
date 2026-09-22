import { MailflowLogo } from "@/components/brand/MailflowLogo";

export const metadata = { title: "No access · Mailflow" };

/**
 * Where a signed-in broker lands when Mailflow is not theirs to use.
 *
 * Covers both cases the layout turns away — an account that has been
 * disabled, and one that simply is not an administrator — with the same
 * wording, because the outcome is identical from here and which of the
 * two it is is not something worth telling an unauthorised visitor.
 *
 * It exists because both of those redirects pointed at routes inherited
 * from LoanFlow (`/dashboard` and `/access-revoked`), neither of which
 * is in this app. Being turned away produced a bare 404, which reads as
 * a broken product rather than a closed door.
 */
export default function NoAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-8 py-16">
      <div className="flex justify-center">
        <MailflowLogo size="lg" mark />
      </div>
      <h1
        className="mt-8 text-center text-[28px] font-medium leading-[1.15] tracking-tight text-brand"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Mailflow is restricted<span className="text-ink-mute">.</span>
      </h1>
      <p className="mt-4 text-center text-[14px] leading-[1.6] text-ink-soft">
        Your account is signed in but does not have access to Mailflow.
        Sending to the client book is limited to administrators.
      </p>
      <p className="mt-3 text-center text-[13px] leading-[1.6] text-ink-mute">
        If you think that is wrong, ask Michael to grant you access.
      </p>
    </main>
  );
}

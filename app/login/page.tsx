import { MailflowLogo } from "@/components/brand/MailflowLogo";
import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";
import { authBypassEnabled } from "@/lib/auth/skip-auth";

export const metadata = {
  title: "Sign in · Mailflow",
};

/**
 * Mailflow's front door.
 *
 * This deployment is Mailflow and nothing else, so the page says so.
 * It arrived here as a copy of LoanFlow's sign-in and kept LoanFlow's
 * logo, wording and — more expensively — LoanFlow's post-sign-in
 * destination, which does not exist in this app. A broker who signed in
 * successfully landed on a 404.
 *
 * Customers never see this. They arrive through a tracking or
 * unsubscribe link, which carries its own signed token.
 */
export default function LoginPage() {
  /* The shared, hardened gate: SKIP_AUTH must be exactly "true" AND the
     build must not be a production one. The previous check here was
     `SKIP_AUTH !== "false"`, which failed open — with the variable
     unset, as it is on every deployment, it rendered a "sign-in is
     bypassed" notice on the live sign-in page. */
  const bypassed = authBypassEnabled();

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-8 py-16">
      <div className="flex justify-center">
        <MailflowLogo size="lg" mark />
      </div>
      <h1
        className="mt-8 text-center text-[32px] font-medium leading-[1.1] tracking-tight text-brand"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in to Mailflow<span className="text-ink-mute">.</span>
      </h1>
      <div className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-brand/70">
        Campaigns · Sequences
      </div>
      <p className="mt-4 text-center text-[14px] leading-[1.6] text-ink-soft">
        Mankin Finance brokers and loan associates only. Customers reach their
        preferences through the link at the bottom of any email we send.
      </p>

      <form
        action={async () => {
          "use server";
          /* Mailflow has no /dashboard — its home is the marketing
             dashboard. Sending brokers to LoanFlow's route meant a
             successful sign-in ended on a 404. */
          await signIn("microsoft-entra-id", { redirectTo: "/marketing" });
        }}
        className="mt-10"
      >
        <Button type="submit" className="w-full" size="lg">
          Sign in with Microsoft
        </Button>
      </form>

      {bypassed && (
        <div className="mt-6 rounded-lg border border-warn-soft bg-warn-soft/60 px-4 py-3 text-[12px] leading-[1.5] text-warn-ink">
          <b>SKIP_AUTH is true</b> — sign-in is bypassed locally. Remove it from{" "}
          <code className="rounded bg-surface px-1 py-px text-[11.5px]">.env.local</code>
          {" "}to exercise the real Microsoft flow.
        </div>
      )}
    </main>
  );
}

import { MailflowLogo } from "@/components/brand/MailflowLogo";
import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";
import { authBypassEnabled } from "@/lib/auth/skip-auth";
import { describeSignInError } from "@/lib/auth/signin-error";
import { safeCallbackPath } from "@/lib/auth/callback-url";
import { headers } from "next/headers";

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
 *
 * Auth.js reports a failed sign-in by sending the broker back here
 * with `?error=<code>`. That has to be read and shown: a page that
 * ignores it renders a rejection as a fresh sign-in page, which reads
 * as a button that does nothing.
 *
 * It also passes `?callbackUrl=<where they were going>`. Sending
 * everyone to the dashboard regardless turned every shared deep link
 * into "the dashboard" for anyone whose session had lapsed — the link
 * looks broken when the only thing that happened is a sign-in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const problem = describeSignInError(error);

  /* The origin is needed to tell "an absolute URL back to us" from
     "an absolute URL somewhere else", which is the difference between
     honouring a deep link and being an open redirect. */
  const host = (await headers()).get("host");
  const destination = safeCallbackPath(
    callbackUrl,
    host ? `https://${host}` : undefined,
  );
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

      {problem && (
        <div
          className="mt-6 rounded-lg border px-4 py-3"
          style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
        >
          <p className="text-[13px] font-bold" style={{ color: "#8a3733" }}>
            {problem.headline}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            {problem.detail}
          </p>
          <p className="mono mt-1.5 text-[10.5px] text-ink-faint">
            {problem.code}
          </p>
        </div>
      )}

      <form
        action={async () => {
          "use server";
          /* Mailflow has no /dashboard — its home is the marketing
             dashboard. Sending brokers to LoanFlow's route meant a
             successful sign-in ended on a 404. `destination` is that
             home unless the broker was heading somewhere specific and
             the path survived validation. */
          await signIn("microsoft-entra-id", { redirectTo: destination });
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

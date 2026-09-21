import { LoanflowLogo } from "@/components/brand/LoanflowLogo";
import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";

export const metadata = {
  title: "Sign in · LoanFlow",
};

/**
 * Broker SSO sign-in. Calls Auth.js signIn() server action which kicks
 * off the Microsoft Entra ID OAuth flow. Customers don't see this — they
 * use the /portal/[token] route with SMS OTP.
 *
 * While SKIP_AUTH=true, the proxy's authorized() returns true so the
 * dashboard never redirects here. To activate real SSO: flip SKIP_AUTH
 * to false and fill the AUTH_MICROSOFT_ENTRA_ID_* envs.
 */
export default function LoginPage() {
  const skipAuth = process.env.SKIP_AUTH !== "false";

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-8 py-16">
      <div className="flex justify-center">
        <LoanflowLogo size="lg" mark />
      </div>
      <h1
        className="mt-8 text-center text-[32px] font-medium leading-[1.1] tracking-tight text-brand"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in to LoanFlow<span className="text-ink-mute">.</span>
      </h1>
      <div className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-brand/70">
        Pipeline · Settled
      </div>
      <p className="mt-4 text-center text-[14px] leading-[1.6] text-ink-soft">
        Mankin Finance brokers and loan associates only. Customers head to the link in your email or SMS.
      </p>

      <form
        action={async () => {
          "use server";
          await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
        }}
        className="mt-10"
      >
        <Button type="submit" className="w-full" size="lg">
          Sign in with Microsoft
        </Button>
      </form>

      {skipAuth && (
        <div className="mt-6 rounded-lg border border-warn-soft bg-warn-soft/60 px-4 py-3 text-[12px] leading-[1.5] text-warn-ink">
          <b>SKIP_AUTH is true</b> — sign-in is bypassed in dev. Flip it in{" "}
          <code className="rounded bg-surface px-1 py-px text-[11.5px]">web/.env.local</code>
          {" "}and fill the Entra ID env vars to activate real SSO.
        </div>
      )}
    </main>
  );
}

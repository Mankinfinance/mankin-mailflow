import { redirect } from "next/navigation";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin, isUserDisabled } from "@/lib/auth/permissions";
import { MailflowAssistant } from "@/components/mailflow/Assistant";

/**
 * Mailflow route-group layout — the marketing module's own shell.
 *
 * Separate from the (dashboard) group because Mailflow carries its own
 * left navigation; the two share the app's tokens and auth, not their
 * chrome. Admin-gated at the layout so a deep link into any marketing
 * screen bounces the same way, rather than each page repeating the check.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MailflowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const broker = await currentBroker();
  /* Both destinations were LoanFlow's — `/access-revoked` and
     `/dashboard` — and neither route exists here, so being turned away
     from Mailflow produced a 404 that read as a broken product rather
     than a closed door. */
  if (await isUserDisabled(broker.id)) redirect("/no-access");
  if (!(await canAccessAdmin(broker.id))) redirect("/no-access");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-paper">
      {children}
      {/* In the layout, which stays mounted across navigation, so a
          question asked on one screen is still there on the next. */}
      <MailflowAssistant firstName={broker.name.split(" ")[0] || broker.name} />
    </div>
  );
}

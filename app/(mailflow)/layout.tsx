import { redirect } from "next/navigation";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin, isUserDisabled } from "@/lib/auth/permissions";

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
  if (await isUserDisabled(broker.id)) redirect("/access-revoked");
  if (!(await canAccessAdmin(broker.id))) redirect("/dashboard");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-paper">{children}</div>
  );
}

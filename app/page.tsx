import { redirect } from "next/navigation";

/**
 * Mailflow's front door.
 *
 * This deployment is Mailflow and nothing else, so the root is not a
 * launcher — it is the dashboard, one redirect away. The LoanFlow
 * launcher lives in the other repo, where the other product is.
 */
export default function Home() {
  redirect("/marketing");
}

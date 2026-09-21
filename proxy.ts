/**
 * Next 16's "middleware" was renamed to `proxy` to clarify its role
 * (network boundary, not arbitrary edge logic).
 *
 * Auth.js v5 exports an `auth` function that, when used here, gates routes
 * according to the `authorized` callback in auth.config.ts. While
 * SKIP_AUTH=true, that callback returns true for everything so the
 * dashboard runs without a real Entra tenant.
 *
 * Note: Next 16's `proxy.ts` runs on the Node.js runtime, not edge.
 */
export { auth as proxy } from "@/auth";

export const config = {
  /* Skip Next internals + static assets + api/cron/*. The cron handlers
     gate themselves on CRON_SECRET; routing them through the Auth.js
     proxy gets them 307'd to /login because Vercel's cron invocations
     have no session, which silently breaks every scheduled job. The
     handlers are still safe - the bearer-token check is per-handler. */
  matcher: [
    "/((?!_next/static|_next/image|api/cron/|brand/|favicon.ico|.*\\.png$|.*\\.svg$).*)",
  ],
};

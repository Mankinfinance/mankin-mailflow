import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authBypassEnabled, emailDomainAllowed } from "@/lib/auth/skip-auth";

/**
 * Edge-safe Auth.js config — providers + callbacks that don't touch
 * Node-only APIs. Imported by `proxy.ts` (Next 16's renamed middleware)
 * so it stays edge-safe in case we ever move proxy to the edge runtime.
 *
 * Full config (incl. DB adapter when we add one) lives in auth.ts.
 *
 * Activation: set SKIP_AUTH=false + fill the AUTH_MICROSOFT_ENTRA_ID_*
 * envs in web/.env.local. Phase 1 keeps SKIP_AUTH=true so the dashboard
 * runs without a real Entra tenant.
 *
 * Scopes: sign-in only (openid, profile, email, User.Read).
 *
 * This used to also ask for Mail.ReadWrite, Mail.Send,
 * Calendars.ReadWrite and offline_access, and kept the resulting
 * Microsoft access and refresh tokens in the session - which Auth.js
 * returns as JSON from /api/auth/session to any script on the page.
 * Mailflow never used them: it sends with the app's own Microsoft
 * credentials (lib/clients/outlook-app-only.ts). A token nobody uses is
 * only a token someone can steal, so they are neither requested nor
 * kept.
 */
const GRAPH_SCOPES = ["openid", "profile", "email", "User.Read"];

export default {
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: {
        params: {
          scope: GRAPH_SCOPES.join(" "),
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    /**
     * Only the firm's own accounts may sign in. The Entra issuer already
     * limits sign-in to the Mankin tenant, but a tenant also holds guest
     * users (B2B invitees with outside email addresses); they are turned
     * away here, before a session exists.
     */
    signIn({ user, profile }) {
      if (authBypassEnabled()) return true;
      const email =
        user?.email ??
        (profile as { email?: string; preferred_username?: string } | undefined)?.email ??
        (profile as { preferred_username?: string } | undefined)?.preferred_username;
      return emailDomainAllowed(email);
    },
    async jwt({ token }) {
      /* Sessions created before the scopes were cut still carry the
         Microsoft tokens; drop them the next time the cookie is read. */
      const t = token as Record<string, unknown>;
      delete t.msAccessToken;
      delete t.msRefreshToken;
      delete t.msAccessTokenExpiresAt;
      return token;
    },
    authorized({ auth, request }) {
      // Auth is enforced on every deployment. Bypass is dev-only and requires
      // an explicit SKIP_AUTH=true (see authBypassEnabled) — a missing, empty,
      // or typo'd env var can no longer open the dashboard in production.
      // Matches the same gate in lib/auth/current-broker.ts.
      if (authBypassEnabled()) return true;

      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/api/auth") ||
        pathname === "/api/health" ||
        // External integration receivers authenticate with their own shared
        // secret / API re-check, not a session, so they must reach their
        // handler rather than being bounced to /login.
        pathname.startsWith("/api/webhooks/") ||
        pathname.startsWith("/api/breezedoc/") ||
        pathname.startsWith("/portal/") ||
        // Campaign tracking + unsubscribe endpoints. These are opened
        // from a customer's inbox, so they can never require a session —
        // an unsubscribe link that bounces to /login is an unsubscribe
        // link that does not work.
        pathname.startsWith("/e/") ||
        // Hosted enquiry forms and their public endpoints. A form on the
        // firm's website is reached by strangers; requiring a session
        // would make it unusable by the only people it is for.
        pathname.startsWith("/f/") ||
        // Survey response pages, opened from a client's inbox. Exactly
        // the same reasoning as /e/ above, and missed when surveys were
        // added: a survey link that bounces to a staff sign-in page is
        // a survey nobody can answer.
        pathname.startsWith("/s/") ||
        pathname.startsWith("/api/forms/") ||
        // One-click unsubscribe, POSTed by Gmail and Yahoo.
        pathname.startsWith("/api/e/") ||
        // Published landing pages and their view counter.
        pathname.startsWith("/p/") ||
        pathname.startsWith("/api/pages/") ||
        // Uploaded images, fetched by the mail client rendering an
        // email. It has no session and never will, and a signed URL
        // would expire while the email in the inbox does not.
        //
        // Reading one is public; adding one is not — /api/files/upload
        // is excluded here and admin-gates itself besides.
        (pathname.startsWith("/api/files/") &&
          pathname !== "/api/files/upload") ||
        pathname === "/login" ||
        pathname === "/" ||
        pathname.startsWith("/styleguide") ||
        // PWA install assets must be readable without a session so the
        // browser can show "Install app" and render the desktop icon.
        // None of these are sensitive (the logo is on the login page).
        pathname === "/manifest.webmanifest" ||
        // The service worker and its offline page: the browser fetches
        // them to install the app, before anyone has signed in.
        pathname === "/sw.js" ||
        pathname === "/offline.html" ||
        pathname === "/favicon.ico" ||
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/icons/");

      if (isPublic) return true;
      return !!auth?.user; // gate /dashboard and anything else
    },
  },
} satisfies NextAuthConfig;

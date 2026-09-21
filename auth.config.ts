import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authBypassEnabled } from "@/lib/auth/skip-auth";

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
 * Scopes:
 *  - openid / profile / email / User.Read: SSO basics.
 *  - Mail.ReadWrite: lets us POST /me/messages to create a real Outlook
 *    draft (with HTML body, bold, signature) the broker reviews before
 *    sending. Mail.ReadWrite is a superset of Mail.Read so we don't need
 *    that extra scope.
 *  - Mail.Send: allows the app to send mail as the signed-in broker via
 *    Graph /me/sendMail. Used by the Composer's "Send via Outlook" path
 *    when EMAIL_AUTOSEND=true.
 *  - Calendars.ReadWrite: lets the CX Manager calendar read the broker's
 *    live Outlook events (GET /me/calendarView) and book meetings on
 *    their calendar (POST /me/events), including Teams online meetings.
 *    Adding this scope requires brokers to re-consent — sign out and back
 *    in — before the token carries calendar access.
 *  - offline_access: returns a refresh token so we can renew the access
 *    token without bouncing the broker through sign-in again.
 */
const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
];

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
     * Persist the Microsoft access + refresh tokens in the JWT so server
     * actions can call Graph as the broker without re-prompting. Access
     * token rotates every ~1 hour; refresh token lasts ~90 days. Server
     * actions check expiry and refresh via Microsoft's token endpoint.
     */
    async jwt({ token, account }) {
      if (account) {
        token.msAccessToken = account.access_token ?? null;
        token.msRefreshToken = account.refresh_token ?? null;
        // expires_at is seconds since epoch when account.access_token expires.
        token.msAccessTokenExpiresAt = account.expires_at ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose just-enough so server actions can pick the tokens up via
      // auth(). The client never sees these — they're only readable in
      // server-side getMicrosoftAccessToken().
      session.msAccessToken =
        (token as { msAccessToken?: string | null }).msAccessToken ?? null;
      session.msRefreshToken =
        (token as { msRefreshToken?: string | null }).msRefreshToken ?? null;
      session.msAccessTokenExpiresAt =
        (token as { msAccessTokenExpiresAt?: number | null })
          .msAccessTokenExpiresAt ?? null;
      return session;
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
        pathname.startsWith("/api/forms/") ||
        // One-click unsubscribe, POSTed by Gmail and Yahoo.
        pathname.startsWith("/api/e/") ||
        // Published landing pages and their view counter.
        pathname.startsWith("/p/") ||
        pathname.startsWith("/api/pages/") ||
        pathname === "/login" ||
        pathname === "/" ||
        pathname.startsWith("/styleguide") ||
        // PWA install assets must be readable without a session so the
        // browser can show "Install app" and render the desktop icon.
        // None of these are sensitive (the logo is on the login page).
        pathname === "/manifest.webmanifest" ||
        pathname === "/favicon.ico" ||
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/icons/");

      if (isPublic) return true;
      return !!auth?.user; // gate /dashboard and anything else
    },
  },
} satisfies NextAuthConfig;

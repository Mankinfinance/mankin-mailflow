import "next-auth";
import "next-auth/jwt";

/**
 * Augment the Auth.js session + JWT types so server actions can read
 * the Microsoft Graph tokens persisted by auth.config.ts callbacks.
 *
 * msAccessToken: Microsoft access token, ~1 hour TTL. Use to call
 *   Graph /me/sendMail and other delegated endpoints.
 * msRefreshToken: refresh token, ~90 days TTL. Used to mint a new
 *   access token without bouncing the broker through sign-in.
 * msAccessTokenExpiresAt: unix seconds when msAccessToken expires.
 */
declare module "next-auth" {
  interface Session {
    msAccessToken?: string | null;
    msRefreshToken?: string | null;
    msAccessTokenExpiresAt?: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    msAccessToken?: string | null;
    msRefreshToken?: string | null;
    msAccessTokenExpiresAt?: number | null;
  }
}

/**
 * Turning an Auth.js error code into something a broker can act on.
 *
 * Auth.js signals a failed sign-in by redirecting back to the sign-in
 * page with `?error=<code>` and nothing else. If the page ignores it —
 * as this one did — a rejected sign-in renders as a fresh sign-in page,
 * and the honest description of the experience is "the button does
 * nothing". It was doing plenty; none of it was visible.
 *
 * Each message names the likely cause and where to fix it, because the
 * person reading this is the person who can fix it.
 */

export interface SignInProblem {
  headline: string;
  detail: string;
  /** The raw code, shown small — it is what a search engine wants. */
  code: string;
}

export function describeSignInError(
  code: string | undefined,
): SignInProblem | null {
  if (!code) return null;

  switch (code) {
    case "OAuthCallbackError":
    case "Callback":
      return {
        code,
        headline: "Microsoft signed you in, but the handover failed",
        detail:
          "This is almost always the app's client secret being wrong — often the Secret ID copied instead of the Value. Make a new client secret in the Entra app registration, copy the Value column, and update AUTH_MICROSOFT_ENTRA_ID_SECRET in Vercel. It needs a redeploy to take effect.",
      };

    case "OAuthSignin":
      return {
        code,
        headline: "Could not start the Microsoft sign-in",
        detail:
          "Usually a missing or malformed AUTH_MICROSOFT_ENTRA_ID_ISSUER or _ID. Check both in Vercel: the issuer is https://login.microsoftonline.com/<tenant-id>/v2.0 and the id is the app's Application (client) ID.",
      };

    case "AccessDenied":
      return {
        code,
        headline: "That account is not allowed in",
        detail:
          "Mailflow only admits Mankin Finance addresses, and only team members it recognises. If this is your work account, check it is listed in the team table.",
      };

    case "Configuration":
      return {
        code,
        headline: "The sign-in is not configured",
        detail:
          "AUTH_SECRET is missing or the provider settings are incomplete. Check the environment variables in Vercel, then redeploy — new variables do not apply to a build that already exists.",
      };

    case "Verification":
      return {
        code,
        headline: "That sign-in link has expired",
        detail: "Start again from this page.",
      };

    default:
      return {
        code,
        headline: "Microsoft turned the sign-in down",
        detail:
          "The code above is the useful part. If it is not obvious, the Vercel runtime logs for this deployment will carry the full reason.",
      };
  }
}

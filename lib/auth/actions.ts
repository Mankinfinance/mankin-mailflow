"use server";

import { signIn, signOut } from "@/auth";

/**
 * Server-side sign-out + sign-in helpers. Auth.js v5 exposes both as
 * functions that can be called from a server action and will produce a
 * proper redirect rather than the dual fetch round-trip you get from
 * `next-auth/react`. Using these from a form action means the browser
 * sees a single 302 to Microsoft instead of a JS dance that can fail
 * silently in production.
 */

/** Sign out the current session and land on /login. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/**
 * Re-authenticate with Microsoft Entra so the JWT picks up the latest
 * scopes (Mail.Send, offline_access, etc.). signIn with redirectTo
 * triggers an Auth.js redirect to Microsoft; once the user completes
 * sign-in they land back on /dashboard/setup with a fresh session
 * carrying the Microsoft access token.
 */
export async function reauthMicrosoftAction(): Promise<void> {
  await signIn("microsoft-entra-id", { redirectTo: "/dashboard/setup" });
}

import NextAuth from "next-auth";
import authConfig from "./auth.config";

/**
 * Full Auth.js config. This is the import every server-side caller uses:
 *  - app/api/auth/[...nextauth]/route.ts re-exports { GET, POST }
 *  - lib/auth/current-broker.ts calls auth() to resolve the session
 *
 * When you add a DB adapter (Drizzle/Supabase) it goes here, not in
 * auth.config.ts — that file must stay edge-safe.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" }, // change to "database" once a DB adapter lands
});

/**
 * Auth.js OAuth callback handler. Microsoft Entra ID redirects to
 * /api/auth/callback/microsoft-entra-id which Auth.js handles via
 * these exported route handlers.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;

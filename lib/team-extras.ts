import "server-only";
import { cache } from "react";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { teamExtras, type TeamExtraRow, type NewTeamExtra } from "./db/schema";
import type { TeamMember } from "./team";

/**
 * Runtime-added team members. The original Mankin Finance staff live
 * in lib/team.ts (hardcoded TEAM constant); this module handles
 * anyone Michael adds later through /dashboard/setup.
 *
 * Why a separate table: TeamMemberId is a literal-typed union of the
 * hardcoded ids ("mm", "na", "ds", ...). Adding new ids at runtime
 * has to bypass that union — extras get a "tex_" prefix so they never
 * collide and aren't accepted where the literal union is enforced.
 *
 * Surfaces that should include extras call listTeamExtras() and
 * extras-aware lookups call findExtraTeamMember(id) — those callers
 * already accept the same shape as the static TEAM members.
 */

/** Project a DB row down to the shape the rest of the app expects from
 *  lib/team.ts. Useful for surfaces that already render TeamMember. */
function toTeamMember(row: TeamExtraRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role as TeamMember["role"],
    initials: row.initials,
    color: row.color,
    short: row.short,
    email: row.email,
    phone: row.phone,
    bookingUrl: row.bookingUrl,
  };
}

/** Every extras row, newest first. Cached per-request so the setup
 *  page + permission resolver share one read. */
export const listTeamExtras = cache(async (): Promise<TeamMember[]> => {
  if (!process.env.DATABASE_URL) return [];
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(teamExtras)
      .orderBy(desc(teamExtras.createdAt));
    return rows.map(toTeamMember);
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return [];
    console.error("[team-extras] read failed", err);
    return [];
  }
});

/** Look up one extras row by id. Returns null when missing. */
export async function findExtraTeamMember(
  id: string,
): Promise<TeamMember | null> {
  const all = await listTeamExtras();
  return all.find((m) => m.id === id) ?? null;
}

export interface AddTeamExtraInput {
  name: string;
  role: TeamMember["role"];
  email: string;
  phone: string;
  short: string;
  initials: string;
  color: string;
  createdBy: string;
}

/** Insert a new extras row. Caller has already validated input.
 *  Self-heals the table on first write so deployments where migration
 *  0005 hasn't run yet (or first dev runs without pnpm db:migrate)
 *  still succeed. */
export async function addTeamExtra(
  input: AddTeamExtraInput,
): Promise<TeamMember> {
  const db = getDb();
  const id = makeExtraId(input.short);
  const row: NewTeamExtra = {
    id,
    name: input.name,
    role: input.role,
    short: input.short,
    email: input.email.toLowerCase(),
    phone: input.phone,
    initials: input.initials,
    color: input.color,
    bookingUrl: "",
    createdBy: input.createdBy,
  };
  try {
    const [inserted] = await db.insert(teamExtras).values(row).returning();
    return toTeamMember(inserted);
  } catch (err) {
    if ((err as { code?: string })?.code !== "42P01") throw err;
    await ensureTeamExtrasTable(db);
    const [inserted] = await db.insert(teamExtras).values(row).returning();
    return toTeamMember(inserted);
  }
}

/** Lazily create team_extras if migration 0005 hasn't been applied.
 *  Idempotent (CREATE TABLE IF NOT EXISTS). One-shot per process. */
let selfHealAttempted = false;
async function ensureTeamExtrasTable(db: ReturnType<typeof getDb>): Promise<void> {
  if (selfHealAttempted) return;
  selfHealAttempted = true;
  console.warn(
    "[team-extras] auto-creating team_extras table. Run pnpm db:migrate to make this permanent.",
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "team_extras" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "role" text NOT NULL,
      "short" text NOT NULL,
      "email" text NOT NULL,
      "phone" text DEFAULT '' NOT NULL,
      "initials" text NOT NULL,
      "color" text NOT NULL,
      "booking_url" text DEFAULT '' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_by" text NOT NULL
    );
  `);
  await db.execute(sql`
    ALTER TABLE "team_permissions"
      ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL;
  `);
}

/** Remove an extras row entirely. Permissions row is left behind on
 *  purpose so audit history is preserved; setUserDisabled handles
 *  blocking sign-ins. */
export async function removeTeamExtra(id: string): Promise<void> {
  if (!id.startsWith("tex_")) {
    throw new Error("removeTeamExtra only removes runtime extras (tex_*)");
  }
  const db = getDb();
  await db.delete(teamExtras).where(eq(teamExtras.id, id));
}

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

/** Build a unique-ish id from the short name. Examples:
 *    short="Sam" → tex_sam_a1b2
 *    short="Jo" → tex_jo_d4e6  */
function makeExtraId(short: string): string {
  const slug = short
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "tm";
  const tail = Math.floor(0x10000 + Math.random() * 0xefff).toString(16);
  return `tex_${slug}_${tail}`;
}

/** Pick a colour for a new avatar - deterministic from the name so
 *  re-renders don't flicker. Eight slots from the Mankin palette. */
export function pickAvatarColor(name: string): string {
  const palette = [
    "#1c2566", // brand navy
    "#2b6e4f", // forest
    "#7a3b2a", // terracotta
    "#4a3a7a", // plum
    "#7a6a2a", // ochre
    "#7a2a5a", // magenta
    "#2a6a7a", // teal
    "#5a3a2a", // chestnut
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** Two-letter initials from a name. "Sam Owens" → "SO", single-word
 *  names take first two letters: "Sam" → "SA". */
export function pickInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

import "server-only";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import type { LeaveRow } from "@/lib/db/schema";

/**
 * Handover register — tracks who's on leave and who's covering their
 * workload. The capacity calculator and the UI use this to:
 *
 *  • Show a "covering for X" badge on the covering member's sidebar
 *    entry + avatar.
 *  • Visually fade the on-leave member's avatar in the team list.
 *  • Route the on-leave member's pending workload into the covering
 *    member's capacity calculation, so an over-allocated covering
 *    person reads as such on the Capacity Tree section.
 *
 * Persistence: the leaves table in Drizzle. Mock + real impls flow
 * through repos().leave so the dashboard works without a DB.
 */

export interface ActiveLeave {
  id: string;
  memberId: string;
  coveringMemberId: string;
  startAt: Date;
  endAt: Date | null;
  reason: string | null;
}

/**
 * Snapshot all currently-active leaves. Cached per request via the
 * React cache layer; cheap to call from multiple places in a single
 * render.
 */
export async function activeLeaves(): Promise<ActiveLeave[]> {
  const rows = await repos().leave.listActive();
  return rows.map(toActive);
}

/** The active leave for a specific person, or null if they're working. */
export async function leaveFor(memberId: string): Promise<ActiveLeave | null> {
  const rows = await repos().leave.listActive();
  const row = rows.find((r) => r.memberId === memberId);
  return row ? toActive(row) : null;
}

/**
 * All people IDs the given member is currently covering. Used by the
 * capacity calculator: their "pending workload" should include any
 * deal owned by someone they're covering for.
 */
export async function coveringFor(memberId: string): Promise<string[]> {
  const rows = await repos().leave.listActive();
  return rows
    .filter((r) => r.coveringMemberId === memberId)
    .map((r) => r.memberId);
}

/**
 * Record a new leave. Audited so an admin can see who scheduled
 * what. Returns the inserted row id.
 */
export async function startLeave(args: {
  memberId: string;
  coveringMemberId: string;
  startAt: Date;
  endAt: Date | null;
  reason: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  if (args.memberId === args.coveringMemberId) {
    throw new Error("A member cannot cover themselves");
  }
  if (args.endAt && args.endAt < args.startAt) {
    throw new Error("Leave end must come after leave start");
  }

  const row = await repos().leave.insert({
    memberId: args.memberId,
    coveringMemberId: args.coveringMemberId,
    startAt: args.startAt,
    endAt: args.endAt,
    reason: args.reason,
    createdBy: args.createdBy,
  });

  await auditLog({
    actor: { type: "broker", id: args.createdBy },
    action: "dashboard.handover.start",
    meta: {
      leaveId: row.id,
      memberId: args.memberId,
      coveringMemberId: args.coveringMemberId,
      startAt: args.startAt.toISOString(),
      endAt: args.endAt?.toISOString() ?? null,
      reason: args.reason,
    },
  });

  return { id: row.id };
}

/**
 * End an active leave early (or close one out at its scheduled end).
 * The covering member's capacity returns to normal on the next render.
 */
export async function endLeave(args: {
  leaveId: string;
  endAt: Date;
  endedBy: string;
}): Promise<{ ok: true }> {
  await repos().leave.endLeave(args.leaveId, args.endAt);
  await auditLog({
    actor: { type: "broker", id: args.endedBy },
    action: "dashboard.handover.end",
    meta: { leaveId: args.leaveId, endAt: args.endAt.toISOString() },
  });
  return { ok: true };
}

/**
 * Recent leaves (active + ended) for admin review. Limit is best-effort —
 * the mock repo respects it via array slice, the real repo via SQL.
 */
export async function recentLeaves(limit = 20): Promise<LeaveRow[]> {
  return repos().leave.listRecent(limit);
}

function toActive(row: LeaveRow): ActiveLeave {
  return {
    id: row.id,
    memberId: row.memberId,
    coveringMemberId: row.coveringMemberId,
    startAt: row.startAt,
    endAt: row.endAt,
    reason: row.reason,
  };
}

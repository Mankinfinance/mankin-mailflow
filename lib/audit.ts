import "server-only";
import { headers } from "next/headers";
import { repos } from "./db/repos";

/**
 * App-wide audit helper. Every read/write/download that touches customer
 * data should call this. Per security.jsx the audit log is the primary
 * evidence trail for ASIC RG209 / OAIC breach reporting, so failing
 * silently is acceptable but losing events is not.
 *
 * Actions follow a dotted verb convention:
 *   portal.token.issue
 *   portal.otp.send
 *   portal.otp.verify.ok
 *   portal.otp.verify.fail
 *   portal.session.start
 *   portal.upload
 *   portal.chat.message
 *   portal.chat.transcript
 *   dashboard.composer.send
 *   dashboard.deal.view
 */

export type Actor =
  | { type: "broker"; id: string }
  | { type: "customer"; dealId: string }
  | { type: "system" };

export interface AuditEvent {
  actor: Actor;
  action: string;
  dealId?: string;
  meta?: Record<string, unknown>;
}

export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const hdrs = await headers();
    const ipAddress =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      undefined;
    const userAgent = hdrs.get("user-agent") ?? undefined;

    const { actorType, actorId } = resolveActor(event.actor);

    await repos().audit.insert({
      actorType,
      actorId,
      action: event.action,
      dealId: event.dealId ?? null,
      meta: event.meta ?? null,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });
  } catch (err) {
    // Don't let an audit failure break the user-facing action.
    console.error("[audit] failed to write", { action: event.action, err });
  }
}

function resolveActor(actor: Actor): { actorType: string; actorId: string } {
  switch (actor.type) {
    case "broker":
      return { actorType: "broker", actorId: actor.id };
    case "customer":
      return { actorType: "customer", actorId: actor.dealId };
    case "system":
      return { actorType: "system", actorId: "system" };
  }
}

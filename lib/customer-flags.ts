import "server-only";
import { repos } from "@/lib/db/repos";
import type { CustomerFlag, FlagReason } from "@/lib/customer-flags-shared";

// Re-export the shared types so existing server-side imports
// (`from "@/lib/customer-flags"`) keep working without churn.
export {
  FLAG_REASON_LABEL,
  type CustomerFlag,
  type FlagReason,
} from "@/lib/customer-flags-shared";

/**
 * Customer-flagged docs — server-side reader. Replays the audit log
 * into a per-doc map of currently-active flags.
 *
 * Storage model: audit log only. No new tables. Latest non-cleared
 * flag wins per (deal, doc).
 *
 * Why audit-log only:
 *   - The flag is an annotation, not source-of-truth state. The doc
 *     is still pending/overdue until the broker decides what to do.
 *   - Audit replay is cheap (< 500 events per typical deal).
 *   - No migration cost for a UX feature.
 *
 * The shared types/enum live in `customer-flags-shared.ts` so client
 * components (DocUploader, CustomerFlagBadge) can import them without
 * dragging the DB client into the client bundle.
 */

/** Build the active-flag map for a single deal. Replays the audit log
 *  in chronological order and lets later events override earlier ones.
 *  Cleared flags (portal.doc.flag.clear) drop the entry entirely.
 *  Uploads also clear any prior flag — the customer obviously found a
 *  way to provide it. */
export async function customerFlagsForDeal(dealId: string): Promise<
  Map<string, CustomerFlag>
> {
  const out = new Map<string, CustomerFlag>();
  try {
    const events = await repos().audit.list({ dealId, limit: 500 });
    // Audit list returns desc by createdAt; flip so we replay oldest first
    // and the most recent event wins by simple overwrite/delete.
    const ordered = [...events].sort((a, b) => {
      const aT = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const bT = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return aT - bT;
    });

    for (const ev of ordered) {
      if (ev.action === "portal.doc.flag") {
        const meta = (ev.meta ?? {}) as {
          docId?: string;
          reason?: FlagReason;
          explanation?: string;
        };
        if (!meta.docId || !meta.reason) continue;
        out.set(meta.docId, {
          docId: meta.docId,
          reason: meta.reason,
          explanation: meta.explanation ?? "",
          flaggedAt:
            ev.createdAt instanceof Date
              ? ev.createdAt.toISOString()
              : String(ev.createdAt),
        });
      } else if (ev.action === "portal.doc.flag.clear") {
        const meta = (ev.meta ?? {}) as { docId?: string };
        if (meta.docId) out.delete(meta.docId);
      } else if (ev.action === "portal.upload") {
        // Uploading a doc clears any prior flag automatically — the
        // customer obviously found a way to provide it.
        const meta = (ev.meta ?? {}) as { docId?: string };
        if (meta.docId) out.delete(meta.docId);
      }
    }
  } catch (err) {
    console.warn("[customer-flags] audit read failed", err);
  }
  return out;
}

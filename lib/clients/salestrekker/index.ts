import "server-only";

import type { Deal, StageId } from "./types";
import { MOCK_DEALS } from "./mock";
import {
  getImportedDeal,
  getImportedDeals,
  updateImportedDeal,
} from "../../imported-deals-store";

/**
 * The slice of Salestrekker the dashboard talks to.
 *
 * Mock and real implementations both satisfy this interface. The mock returns
 * the 6 LEADS from dashboard.jsx; the real client (added once the CSM call
 * confirms API + webhook support) hits Salestrekker REST endpoints per
 * design_handoff_lead_followup/design/components/apis-bulk.jsx.
 */
export interface SalestrekkerClient {
  listDeals(): Promise<Deal[]>;
  getDeal(id: string): Promise<Deal | null>;
  updateStage(id: string, stageId: StageId): Promise<Deal>;
  /**
   * Move the deal to the settled stage AND stamp settledOn / loanAmount
   * in one atomic operation. Use this instead of updateStage("settled")
   * so the deal carries the settlement metadata the CX module + reports
   * need (back-book queue, anniversary check-ins, monthly settlement
   * KPIs all key off settledOn).
   *
   * settledOn must be an ISO yyyy-mm-dd date. loanAmount is optional -
   * pass null to leave whatever value the deal already carries (likely
   * set at conditional approval); pass a number to overwrite.
   */
  markSettled(
    id: string,
    args: { settledOn: string; loanAmount?: number | null },
  ): Promise<Deal>;
  /**
   * Permanently delete a deal. Used by the Delete button on the deal
   * drawer when the broker confirms a deal was created in error (test
   * imports, duplicate entries, customer never proceeded). Irreversible
   * - the deal id stops resolving immediately. Audit trail in our own
   *   audit_log table preserves who deleted it + the appRef + name.
   */
  deleteDeal(id: string): Promise<void>;
  addNote(id: string, body: string): Promise<void>;
  /**
   * Reassign the deal's broker, associate, or both. Pass null to leave
   * a slot unchanged. Phase 4 routes this through PATCH /deals/{id}
   * with the changed owner fields; mock mode just updates the in-memory
   * store so the dashboard's capacity calculator re-renders.
   */
  assign(
    id: string,
    next: { brokerId?: string | null; associateId?: string | null },
  ): Promise<Deal>;
  /**
   * Move a doc from pending/overdue → received on the given deal.
   * Phase 7: the real client gets webhook-driven updates from
   * Salestrekker after a successful /files POST; this helper exists
   * so the portal can optimistically tick the row in the same request.
   */
  markDocReceived(id: string, docId: string): Promise<Deal>;
  /**
   * Reverse of markDocReceived — the broker accidentally ticked a doc
   * or the customer's upload was rejected. Moves the id back to
   * `pending` so the row reappears in the outstanding list.
   */
  unmarkDocReceived(id: string, docId: string): Promise<Deal>;
  /**
   * Mark a doc as not applicable to this deal. Removes it from
   * pending/overdue, never tries to flip received, drops any
   * associated advisory note, and records the id under `excluded`.
   * Idempotent.
   */
  excludeDoc(id: string, docId: string): Promise<Deal>;
  /**
   * Reverse of excludeDoc. Brings the doc back as `pending`.
   */
  unexcludeDoc(id: string, docId: string): Promise<Deal>;
  /**
   * Add a broker-defined doc to the deal's checklist. Custom docs land
   * in `pending` immediately. Custom doc metadata also stored under
   * `customDocs` so the dashboard can render name + hint without
   * needing the rule-engine catalog.
   */
  addCustomDoc(
    id: string,
    doc: { id: string; name: string; hint?: string; cat?: string },
  ): Promise<Deal>;
  /**
   * Remove a broker-defined doc. Drops it from customDocs + the status
   * arrays. Doesn't affect any uploaded file already attached.
   */
  removeCustomDoc(id: string, docId: string): Promise<Deal>;
  /**
   * Toggle whether this deal participates in the 4pm end-of-day brief
   * generation. Used by the EOD deck's "Stop daily updates" button.
   */
  setExcludeFromDailyUpdates(id: string, exclude: boolean): Promise<Deal>;
  /**
   * Update the deal's lender. The string is canonical (already formatted
   * via formatLenderForDeal). Phase 4: routes to PATCH /deals/{id} with
   * the lender field.
   */
  setLender(id: string, lender: string): Promise<Deal>;
  setEmail(id: string, email: string): Promise<Deal>;
  /**
   * Set the optional second contact email for a combined "A & B" applicant.
   * CC'd on every customer email. Pass "" to clear it.
   */
  setSecondaryEmail(id: string, email: string): Promise<Deal>;
  setName(id: string, name: string): Promise<Deal>;
  setPhone(id: string, phone: string): Promise<Deal>;
  /** Store the deal's SharePoint document-folder web URL (captured on the
   *  first upload). Returns the updated deal. */
  setSharepointUrl(id: string, url: string): Promise<Deal>;
  /**
   * Update the deal's expected settlement date string. Format "14 Jul" | "TBD".
   * Used by the settlement-date edit button in the deal drawer.
   */
  setSettlement(id: string, settlement: string): Promise<Deal>;
  /**
   * Record the pre-approval date and expiry. Expiry defaults to
   * approvalDate + 3 months when not explicitly set. Pass null for
   * both to clear. Used by PreApprovalButton in the deal drawer.
   */
  setPreApproval(
    id: string,
    args: { approvalDate: string | null; expiryDate: string | null },
  ): Promise<Deal>;
  /**
   * Update the deal's loan purpose. "purchase" unlocks the conveyancer
   * card; "refinance" hides it; "unknown" is the broker-hasn't-confirmed
   * state.
   */
  setPurpose(id: string, purpose: Deal["purpose"]): Promise<Deal>;
  /**
   * Set or clear the conveyancer assigned to a purchase deal. Pass null
   * to remove. Real client will POST to a Salestrekker custom-field
   * endpoint or to a separate conveyancers table.
   */
  setConveyancer(id: string, conveyancer: Deal["conveyancer"]): Promise<Deal>;
  /**
   * Move the deal into the nurture list (or return it to active).
   * Pass `at: Date` plus an optional reason to nurture; pass `null` to
   * return to active. Nurtured deals are excluded from the main
   * pipeline, capacity, today queue, EOD briefs, and forecast — they
   * surface only on /dashboard/nurture until the broker returns them.
   */
  setNurtured(
    id: string,
    at: Date | null,
    reason?: string | null,
  ): Promise<Deal>;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

function createMockClient(): SalestrekkerClient {
  // In-memory store keyed by id — mutated by updateStage/addNote so the
  // dashboard's optimistic flows feel real during local dev.
  const store = new Map<string, Deal>(MOCK_DEALS.map((d) => [d.id, clone(d)]));

  /** Resolve a deal by id. Tries the single-row Postgres lookup first
   *  (SELECT WHERE id=$1) so portal page loads and server actions don't
   *  pay the cost of fetching the full deal table. Falls back to the
   *  in-memory mock dataset for seed deals that were never imported. */
  async function findDeal(id: string): Promise<Deal | null> {
    const imported = await getImportedDeal(id);
    if (imported) return imported;
    return store.get(id) ?? null;
  }

  /** Apply an update to whichever source owns the deal. */
  async function writeDeal(deal: Deal): Promise<void> {
    const imported = await getImportedDeal(deal.id);
    if (imported) {
      await updateImportedDeal(deal);
    } else {
      store.set(deal.id, deal);
    }
  }

  return {
    async listDeals() {
      /* Import store, when populated, replaces the static mock dataset
         entirely. We used to call hasImportedDeals() + getImportedDeals()
         which fired TWO Postgres round-trips per page render (COUNT + SELECT *).
         With 100+ deals + Supabase Sydney latency that adds up to the
         dashboard feeling sluggish on every click. One fetch is enough -
         length > 0 tells us whether the import store is populated. */
      const imported = await getImportedDeals();
      if (imported.length > 0) {
        /* No clone needed - the imported list comes fresh from Postgres
           on each cache-miss render, so the array isn't a shared mutable
           store. structuredClone on 167 deals with nested arrays was
           costing 30-60ms per render for no benefit. */
        return imported;
      }
      return [...store.values()].map(clone);
    },
    async getDeal(id) {
      const found = await findDeal(id);
      if (!found) return null;
      /* Same reasoning as listDeals: imported deals don't need a clone
         (they're fresh per request), the in-memory store does. We
         can't cheaply tell which source it came from here without
         another lookup, so we clone defensively. The cost is one
         deal's worth of clone, which is fine. */
      return clone(found);
    },
    async assign(id, nextAssignees) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        brokerId: nextAssignees.brokerId ?? deal.brokerId,
        associateId: nextAssignees.associateId ?? deal.associateId,
      };
      await writeDeal(next);
      return clone(next);
    },
    async updateStage(id, stageId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const paFields: Partial<Deal> = {};
      if (stageId === "pre-approval" && !deal.preApprovalDate) {
        const today = new Date();
        const expiry = new Date(today);
        expiry.setMonth(expiry.getMonth() + 3);
        paFields.preApprovalDate = today.toISOString().slice(0, 10);
        paFields.preApprovalExpiry = expiry.toISOString().slice(0, 10);
      }
      const next: Deal = { ...deal, stageId, stageEnteredAt: new Date(), ...paFields };
      await writeDeal(next);
      return clone(next);
    },
    async markSettled(id, { settledOn, loanAmount }) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        stageId: "settled",
        settledOn,
        loanAmount: loanAmount === undefined ? deal.loanAmount : loanAmount,
      };
      await writeDeal(next);
      return clone(next);
    },
    async addNote(id, body) {
      const deal = await findDeal(id);
      if (!deal) {
        // Note logging is non-critical (audit log records the actual
        // event). Swallow missing deal so workflows like batch handover
        // email generation don't fail when an imported file is incomplete.
        console.warn(`[mock salestrekker] note for unknown deal ${id} ignored`);
        return;
      }
      console.log(`[mock salestrekker] note on ${deal.appRef}: ${body}`);
    },
    async deleteDeal(id) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      /* Remove from the in-memory mock store + the persistent import
         table (where applicable). The import-store delete is best-effort
         - if the deal only existed in MOCK_DEALS (i.e. not imported via
         CSV) the import-store call is a no-op. */
      store.delete(id);
      const { deleteImportedDeal } = await import("@/lib/imported-deals-store");
      await deleteImportedDeal(id).catch((err) => {
        console.warn(`[mock salestrekker] deleteImportedDeal failed for ${id}`, err);
      });
    },
    async markDocReceived(id, docId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        overdue: deal.overdue.filter((d) => d !== docId),
        pending: deal.pending.filter((d) => d !== docId),
        received: deal.received.includes(docId) ? deal.received : [...deal.received, docId],
      };
      await writeDeal(next);
      return clone(next);
    },
    async unmarkDocReceived(id, docId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        received: deal.received.filter((d) => d !== docId),
        // Put it back on pending so the customer is asked for it again.
        // We do not restore overdue tone automatically — the broker can
        // re-ask via the composer if they want urgency back on the row.
        pending: deal.pending.includes(docId) || deal.overdue.includes(docId)
          ? deal.pending
          : [...deal.pending, docId],
      };
      await writeDeal(next);
      return clone(next);
    },
    async excludeDoc(id, docId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        overdue: deal.overdue.filter((d) => d !== docId),
        pending: deal.pending.filter((d) => d !== docId),
        advisory: deal.advisory.filter((a) => a.id !== docId),
        excluded: deal.excluded.includes(docId) ? deal.excluded : [...deal.excluded, docId],
      };
      await writeDeal(next);
      return clone(next);
    },
    async unexcludeDoc(id, docId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        excluded: deal.excluded.filter((d) => d !== docId),
        pending: deal.pending.includes(docId) ? deal.pending : [...deal.pending, docId],
      };
      await writeDeal(next);
      return clone(next);
    },
    async addCustomDoc(id, doc) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      // Idempotent on doc.id — re-adds are no-ops.
      if (deal.customDocs.some((d) => d.id === doc.id)) return clone(deal);
      const next: Deal = {
        ...deal,
        customDocs: [...deal.customDocs, doc],
        pending: deal.pending.includes(doc.id) ? deal.pending : [...deal.pending, doc.id],
      };
      await writeDeal(next);
      return clone(next);
    },
    async removeCustomDoc(id, docId) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        customDocs: deal.customDocs.filter((d) => d.id !== docId),
        pending: deal.pending.filter((d) => d !== docId),
        overdue: deal.overdue.filter((d) => d !== docId),
        received: deal.received.filter((d) => d !== docId),
        excluded: deal.excluded.filter((d) => d !== docId),
      };
      await writeDeal(next);
      return clone(next);
    },
    async setExcludeFromDailyUpdates(id, exclude) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = { ...deal, excludeFromDailyUpdates: exclude };
      await writeDeal(next);
      return clone(next);
    },
    async setLender(id, lender) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = { ...deal, lender };
      await writeDeal(next);
      return clone(next);
    },
    async setEmail(id, email) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      // Keep the primary applicant's email in sync with the deal-level
      // email (mirrors setName / setPhone) so the top bar and the Contacts
      // list never diverge.
      const applicants = deal.applicants.map((a, i) =>
        i === 0 ? { ...a, email } : a,
      );
      const next: Deal = { ...deal, email, applicants };
      await writeDeal(next);
      return clone(next);
    },
    async setSecondaryEmail(id, email) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = { ...deal, secondaryEmail: email };
      await writeDeal(next);
      return clone(next);
    },
    async setName(id, name) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const applicants = deal.applicants.map((a, i) =>
        i === 0 ? { ...a, name } : a,
      );
      const next: Deal = { ...deal, name, applicants };
      await writeDeal(next);
      return clone(next);
    },
    async setPhone(id, phone) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const applicants = deal.applicants.map((a, i) =>
        i === 0 ? { ...a, phone } : a,
      );
      const next: Deal = { ...deal, phone, applicants };
      await writeDeal(next);
      return clone(next);
    },
    async setSettlement(id, settlement) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = { ...deal, settlement };
      await writeDeal(next);
      return clone(next);
    },
    async setSharepointUrl(id, url) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Deal ${id} not found`);
      const next: Deal = { ...deal, sharepointUrl: url };
      await writeDeal(next);
      return clone(next);
    },
    async setPreApproval(id, { approvalDate, expiryDate }) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        preApprovalDate: approvalDate,
        preApprovalExpiry: expiryDate,
      };
      await writeDeal(next);
      return clone(next);
    },
    async setPurpose(id, purpose) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      // Clearing conveyancer when leaving purchase keeps stale data out
      // of the UI - if they flip back, they re-enter it.
      const conveyancer = purpose === "purchase" ? deal.conveyancer : null;
      const next: Deal = { ...deal, purpose, conveyancer };
      await writeDeal(next);
      return clone(next);
    },
    async setConveyancer(id, conveyancer) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = { ...deal, conveyancer };
      await writeDeal(next);
      return clone(next);
    },
    async setNurtured(id, at, reason) {
      const deal = await findDeal(id);
      if (!deal) throw new Error(`Mock: deal ${id} not found`);
      const next: Deal = {
        ...deal,
        nurturedAt: at ? at.toISOString() : null,
        nurtureReason: at ? (reason ?? null) : null,
      };
      await writeDeal(next);
      return clone(next);
    },
  };
}

function createRealClient(apiKey: string): SalestrekkerClient {
  void apiKey; // TODO Phase 4: pass to fetch() Authorization header
  // Stub until the CSM call confirms endpoints + webhook support
  // (see design/components/apis-bulk.jsx ⚠ Gotcha for Salestrekker).
  // Same interface as the mock so dashboard code is agnostic.
  throw new Error(
    "Real Salestrekker client not yet implemented. Set MOCK_SALESTREKKER=true in web/.env.local.",
  );
}

let singleton: SalestrekkerClient | null = null;

export function getSalestrekkerClient(): SalestrekkerClient {
  if (singleton) return singleton;

  // Default to mock. Real client activates only when MOCK_SALESTREKKER
  // is explicitly "false" AND an API key is present. Unset env vars
  // (Vercel default, fresh clone) safely route to the mock.
  const useMock =
    process.env.MOCK_SALESTREKKER !== "false" ||
    !process.env.SALESTREKKER_API_KEY;
  if (useMock) {
    singleton = createMockClient();
    return singleton;
  }
  singleton = createRealClient(process.env.SALESTREKKER_API_KEY!);
  return singleton;
}

export type { Deal, StageId, StageMeta, Phase, DocStatus, AdvisoryNote } from "./types";
export {
  stageMeta,
  STAGES,
  totalDocs,
  progressPct,
  isActiveDeal,
  isNurturedDeal,
  isSettledDeal,
} from "./types";

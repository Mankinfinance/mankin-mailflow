import type { SettlementRow } from "./commission-parser";

/**
 * What a commission re-upload will actually change, computed BEFORE the
 * back-book is replaced. Turns a blind REPLACE into a transparent diff so
 * the CX manager can trust a re-import: which loans are new, which carry
 * over, which have dropped off, and — crucially — that review history is
 * preserved (reviews are keyed by the stable Loan ID and live in a
 * separate table the import never touches).
 */
export interface SettlementImportDiff {
  /** Rows in the incoming file. */
  incoming: number;
  /** Loan IDs in the file that weren't in the back-book before. */
  newLoans: number;
  /** Loan IDs present before and after (data refreshed, reviews kept). */
  carriedOver: number;
  /** Loan IDs that were in the back-book but aren't in the new file
   *  (discharged / refinanced away / off the statement). Their settlement
   *  row is removed. */
  droppedOff: number;
  /** Carried-over loans that already have review history — it stays
   *  attached (this is the "it remembers what's been reviewed" number). */
  reviewsPreserved: number;
  /** Dropped-off loans that had review history — now orphaned (harmless,
   *  but surfaced so nothing silently disappears). */
  reviewsOrphaned: number;
  /** Incoming loans flagged discharged/closed on this statement. */
  dischargedOnFile: number;
}

/** Pure diff. `existingIds` = current settlement ids; `reviewedIds` =
 *  settlement ids that have at least one review row. */
export function diffCommissionImport(args: {
  incoming: SettlementRow[];
  existingIds: Iterable<string>;
  reviewedIds: Iterable<string>;
}): SettlementImportDiff {
  const existing = new Set(args.existingIds);
  const reviewed = new Set(args.reviewedIds);
  const incomingIds = new Set(args.incoming.map((r) => r.id));

  let newLoans = 0;
  let carriedOver = 0;
  let reviewsPreserved = 0;
  let dischargedOnFile = 0;

  for (const r of args.incoming) {
    if (existing.has(r.id)) {
      carriedOver += 1;
      if (reviewed.has(r.id)) reviewsPreserved += 1;
    } else {
      newLoans += 1;
    }
    if (r.loanStatus === "discharged" || r.loanStatus === "closed") {
      dischargedOnFile += 1;
    }
  }

  let droppedOff = 0;
  let reviewsOrphaned = 0;
  for (const id of existing) {
    if (!incomingIds.has(id)) {
      droppedOff += 1;
      if (reviewed.has(id)) reviewsOrphaned += 1;
    }
  }

  return {
    incoming: args.incoming.length,
    newLoans,
    carriedOver,
    droppedOff,
    reviewsPreserved,
    reviewsOrphaned,
    dischargedOnFile,
  };
}

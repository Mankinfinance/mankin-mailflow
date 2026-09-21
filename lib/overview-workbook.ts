import "server-only";
import * as XLSX from "xlsx";
import type { OverviewData } from "./overview";
import { MANKIN_STAGES } from "./clients/salestrekker/types";
import { formatTimestampTimeAU } from "@/lib/format-date";

/**
 * Build an .xlsx workbook that reproduces the Mankin Finance Pipeline
 * Dashboard sheet from a computed {@link OverviewData} bundle.
 *
 * This is the export half of the two-way tie with the broker's master
 * spreadsheet: `/dashboard/import` reads their Pipeline Dashboard.xlsb
 * IN (see lib/imported-deals-parser.ts); this writes a refreshed copy
 * of the same six sections back OUT so the master workbook can be kept
 * current straight from the tool.
 *
 * Layout mirrors the on-screen Overview page (and the original sheet):
 *   1. Current Deal Status per Mankin stage (+ priority-flag rows)
 *   2. Loan Type split
 *   3. Deal Source breakdown
 *   4. Current Deal Owners matrix (owner × stage)
 *   5. YTD settled totals (count + $ value)
 *   6. Upcoming settlements list
 *
 * Currency is written as raw numbers (not "$1.2M") so the broker can
 * SUM / pivot the exported figures in Excel. A single "Dashboard"
 * sheet keeps the file a drop-in match for their existing tab.
 */

type Cell = string | number | null;

/** The stage columns used by the owners matrix + the two flag columns
 *  the original sheet carries as if they were stages. */
const OWNER_COLUMNS: readonly string[] = [
  ...MANKIN_STAGES,
  "Outstanding Action",
  "Follow up",
];

function buildDashboardRows(data: OverviewData): Cell[][] {
  const rows: Cell[][] = [];
  const blank = (): void => {
    rows.push([]);
  };

  // Title + provenance
  rows.push(["Mankin Finance — Pipeline Dashboard"]);
  rows.push([
    "Generated",
    formatTimestampTimeAU(data.generatedAt),
  ]);
  rows.push([
    "Total deals",
    data.totalDeals,
    "Active",
    data.totalActive,
    "Nurture",
    data.totalNurtured,
    "Settled",
    data.totalSettled,
  ]);
  blank();

  // 1 — Current Deal Status
  rows.push(["Current Deal Status (Mankin Finance)"]);
  rows.push(["Stage", "Previous Week", "This Week", "Change"]);
  for (const r of data.stageStatus) {
    rows.push([
      r.label,
      r.previous ?? "—",
      r.current,
      r.change ?? "—",
    ]);
  }
  blank();

  // 2 — Loan Type split
  rows.push(["Loan Type Split"]);
  rows.push(["Loan Type", "Count"]);
  for (const r of data.loanTypeSplit) rows.push([r.label, r.current]);
  blank();

  // 3 — Deal Source breakdown
  rows.push(["Deal Source"]);
  rows.push(["Source", "Count"]);
  for (const r of data.sourceBreakdown) rows.push([r.source, r.current]);
  blank();

  // 4 — Current Deal Owners matrix (owner × stage)
  rows.push(["Current Deal Owners"]);
  rows.push(["Owner", ...OWNER_COLUMNS, "Total"]);
  for (const owner of data.ownerBreakdown) {
    rows.push([
      owner.ownerLabel,
      ...OWNER_COLUMNS.map((col) => owner.byStage[col] ?? 0),
      owner.total,
    ]);
  }
  blank();

  // 5 — YTD settled totals
  rows.push([`YTD Settled (${new Date(data.generatedAt).getFullYear()})`]);
  rows.push(["Owner", "Loans", "Value (AUD)"]);
  for (const r of data.ytdSummary.byOwner) {
    rows.push([r.ownerLabel, r.count, r.value]);
  }
  rows.push(["Total", data.ytdSummary.loanCount, data.ytdSummary.loanValue]);
  blank();

  // 6 — Upcoming settlements
  rows.push(["Upcoming Settlements"]);
  rows.push(["Client", "Owner", "Loan Amount (AUD)", "Source", "Settlement"]);
  for (const s of data.upcomingSettlements) {
    rows.push([
      s.name,
      s.ownerLabel,
      s.loanAmount ?? "—",
      s.leadSource || "—",
      s.display,
    ]);
  }

  return rows;
}

export function buildOverviewWorkbook(data: OverviewData): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(buildDashboardRows(data));

  // Widen the leading label columns so stage/owner names aren't clipped.
  ws["!cols"] = [
    { wch: 26 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dashboard");

  // `buffer` output keeps this server-only; the route streams it as a
  // file download.
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

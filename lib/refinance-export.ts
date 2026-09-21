import "server-only";
import * as XLSX from "xlsx";
import { formatDateAU } from "@/lib/format-date";

/**
 * Excel export of the ranked refinance opportunities so the broker can
 * work the list offline or feed it into an outreach campaign. Mirrors the
 * overview export: one sheet, currency as raw numbers so the figures stay
 * summable, and the risk reasons spelled out per row.
 */
export interface RefinanceOppExportRow {
  clientName: string;
  lender: string;
  settlementDate: string;
  currentBalance: number;
  tier: string;
  score: number;
  reasons: string[];
}

export function buildRefinanceOppsWorkbook(
  rows: RefinanceOppExportRow[],
  generatedAt: string,
): Buffer {
  const aoa: (string | number)[][] = [
    ["Mankin Finance — Refinance opportunities"],
    ["Generated", generatedAt, "Loans", rows.length],
    [],
    ["Client", "Lender", "Settled", "Current balance (AUD)", "Refi risk", "Score", "Reasons"],
    ...rows.map((r) => [
      r.clientName,
      r.lender,
      formatDateAU(r.settlementDate),
      r.currentBalance,
      r.tier,
      r.score,
      r.reasons.join("; "),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 26 },
    { wch: 20 },
    { wch: 12 },
    { wch: 20 },
    { wch: 10 },
    { wch: 8 },
    { wch: 64 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Refinance opportunities");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

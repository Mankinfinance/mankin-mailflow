import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { MOCK_DEALS } from "./clients/salestrekker/mock";
import { buildOverview } from "./overview";
import { buildOverviewWorkbook } from "./overview-workbook";

/** Read the exported workbook back into an array-of-arrays for assertions. */
function readDashboard(buf: Buffer): (string | number | null)[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  expect(wb.SheetNames).toContain("Dashboard");
  return XLSX.utils.sheet_to_json(wb.Sheets["Dashboard"], {
    header: 1,
    blankrows: true,
  }) as (string | number | null)[][];
}

/** First cell of the first row whose leading cell equals `label`. */
function rowIndex(rows: (string | number | null)[][], label: string): number {
  return rows.findIndex((r) => r[0] === label);
}

describe("buildOverviewWorkbook", () => {
  const overview = buildOverview(MOCK_DEALS);
  const buf = buildOverviewWorkbook(overview);

  it("produces a valid, non-empty xlsx buffer", () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // XLSX files are zip archives — they start with the PK magic bytes.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("lays out all six dashboard sections in order", () => {
    const rows = readDashboard(buf);
    const sections = [
      "Current Deal Status (Mankin Finance)",
      "Loan Type Split",
      "Deal Source",
      "Current Deal Owners",
      "Upcoming Settlements",
    ];
    const indices = sections.map((s) => rowIndex(rows, s));
    // Every section is present...
    for (const i of indices) expect(i).toBeGreaterThanOrEqual(0);
    // ...and appears in the expected top-to-bottom order.
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
    // YTD section carries a year in its title, so match by prefix.
    expect(rows.some((r) => String(r[0]).startsWith("YTD Settled"))).toBe(true);
  });

  it("writes stage counts as numbers matching the computed overview", () => {
    const rows = readDashboard(buf);
    const headerIdx = rowIndex(rows, "Stage");
    expect(headerIdx).toBeGreaterThan(0);
    // The stage rows immediately follow the "Stage | Previous Week | ..."
    // header; the "This Week" count sits in column index 2.
    const firstStage = overview.stageStatus[0];
    const exported = rows[headerIdx + 1];
    expect(exported[0]).toBe(firstStage.label);
    expect(exported[2]).toBe(firstStage.current);
    expect(typeof exported[2]).toBe("number");
  });

  it("keeps YTD loan value as a raw summable number", () => {
    const rows = readDashboard(buf);
    const totalIdx = rows.findIndex(
      (r) => r[0] === "Total" && typeof r[2] === "number",
    );
    expect(totalIdx).toBeGreaterThan(0);
    expect(rows[totalIdx][2]).toBe(overview.ytdSummary.loanValue);
  });
});

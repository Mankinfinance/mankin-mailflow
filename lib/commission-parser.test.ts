import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCommissionWorkbook } from "./commission-parser";

/**
 * Builds a minimal commission workbook in memory so we can exercise the
 * email tie-in end to end: an "Email" column on the sheet should flow
 * through to SettlementRow.email and the emailsFound count.
 */
function workbook(
  sheets: Record<string, (string | number | null)[][]>,
): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEADERS = ["Client", "Loan ID", "Email", "Settlement Date", "Lender"];

describe("parseCommissionWorkbook — contact email tie-in", () => {
  it("captures a valid email from the sheet and counts it", () => {
    const buf = workbook({
      "Upfront Details": [
        HEADERS,
        ["Reilly, Sarah", "LN123", "sarah@example.com", 46000, "Westpac"],
        ["Chen, Tom", "LN124", "", 46010, "CBA"], // no email
      ],
    });
    const result = parseCommissionWorkbook(buf);
    expect(result.emailsFound).toBe(1);
    const sarah = result.rows.find((r) => r.loanId === "LN123")!;
    expect(sarah.email).toBe("sarah@example.com");
    const tom = result.rows.find((r) => r.loanId === "LN124")!;
    expect(tom.email).toBe("");
  });

  it("ignores malformed emails", () => {
    const buf = workbook({
      "Upfront Details": [HEADERS, ["Nguyen, Tara", "LN200", "not-an-email", 46000, "ANZ"]],
    });
    const result = parseCommissionWorkbook(buf);
    expect(result.emailsFound).toBe(0);
    expect(result.rows[0].email).toBe("");
  });

  it("picks up an email from the trail sheet when the upfront row lacked one", () => {
    const buf = workbook({
      "Upfront Details": [HEADERS, ["Russo, Marco", "LN300", "", 46000, "NAB"]],
      "Trail Details": [HEADERS, ["Russo, Marco", "LN300", "marco@example.com", 46000, "NAB"]],
    });
    const result = parseCommissionWorkbook(buf);
    const row = result.rows.find((r) => r.loanId === "LN300")!;
    expect(row.email).toBe("marco@example.com");
    expect(result.emailsFound).toBe(1);
  });

  it("accepts alternative email column headers", () => {
    const buf = workbook({
      "Upfront Details": [
        ["Client", "Loan ID", "Contact Email", "Settlement Date"],
        ["Wright, Hannah", "LN400", "HANNAH@Example.com", 46000],
      ],
    });
    const result = parseCommissionWorkbook(buf);
    expect(result.rows[0].email).toBe("hannah@example.com"); // normalised lower-case
  });
});

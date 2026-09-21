import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildRefinanceOppsWorkbook } from "./refinance-export";

describe("buildRefinanceOppsWorkbook", () => {
  const rows = [
    {
      clientName: "Sarah Chen",
      lender: "Westpac",
      settlementDate: "2023-05-01",
      currentBalance: 640000,
      tier: "high",
      score: 82,
      reasons: ["3+ years tenured", "High balance"],
    },
    {
      clientName: "Tom Reilly",
      lender: "CBA",
      settlementDate: "2024-02-01",
      currentBalance: 410000,
      tier: "medium",
      score: 55,
      reasons: ["Approaching 18 months"],
    },
  ];
  const buf = buildRefinanceOppsWorkbook(rows, "24 Jul 2026, 9:00 am");

  it("produces a valid xlsx with the opportunities sheet", () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x50); // PK zip magic
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Refinance opportunities");
  });

  it("keeps balance/score as numbers and joins reasons", () => {
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets["Refinance opportunities"], {
      header: 1,
      blankrows: true,
    }) as (string | number)[][];
    const headerIdx = aoa.findIndex((r) => r[0] === "Client");
    const first = aoa[headerIdx + 1];
    expect(first[0]).toBe("Sarah Chen");
    expect(first[3]).toBe(640000); // balance stays numeric
    expect(typeof first[3]).toBe("number");
    expect(first[5]).toBe(82); // score numeric
    expect(String(first[6])).toContain("3+ years tenured");
    expect(String(first[6])).toContain(";"); // reasons joined
  });
});

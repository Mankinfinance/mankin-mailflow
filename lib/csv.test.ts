import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Chen, "Sarah"')).toBe('"Chen, ""Sarah"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("stops a spreadsheet running a typed-in formula", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("+61 400 000 000")).toBe("'+61 400 000 000");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("-1")).toBe("'-1");
  });

  it("writes dates as ISO, empties as blank, and starts with a BOM for Excel", () => {
    expect(csvCell(new Date("2026-11-14T00:00:00Z"))).toBe("2026-11-14T00:00:00.000Z");
    expect(csvCell(null)).toBe("");
    const out = toCsv(["a", "b"], [[1, null]]);
    expect(out).toBe("﻿a,b\r\n1,\r\n");
  });
});

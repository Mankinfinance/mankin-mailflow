import { describe, it, expect } from "vitest";
import { isCalendarDate, parseCsv, readContacts, toIsoDate } from "./contacts-import";

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, and CRLF", () => {
    expect(parseCsv('a,b\r\n"Chen, Sarah","line\nbreak"\r\n"say ""hi""",x\n')).toEqual([
      ["a", "b"],
      ["Chen, Sarah", "line\nbreak"],
      ['say "hi"', "x"],
    ]);
  });

  it("reads semicolon files from Excel in other locales", () => {
    expect(parseCsv("Email;Name\nx@example.com;Jo")).toEqual([
      ["Email", "Name"],
      ["x@example.com", "Jo"],
    ]);
  });

  it("drops a byte-order mark and blank lines", () => {
    expect(parseCsv("﻿Email\n\nx@example.com\n\n")).toEqual([["Email"], ["x@example.com"]]);
  });
});

describe("readContacts", () => {
  it("finds the columns by heading, whatever they're called", () => {
    const r = readContacts("First Name,Surname,E-mail Address,Mobile\nJo,Park,JO@Example.com,0400 000 000");
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toEqual([{ email: "jo@example.com", name: "Jo Park", phone: "0400 000 000" }]);
  });

  it("works without a heading row", () => {
    const r = readContacts("Sarah Chen,sarah@example.com\nTom Lee,tom@example.com");
    if ("error" in r) throw new Error(r.error);
    expect(r.rows.map((x) => x.name)).toEqual(["Sarah Chen", "Tom Lee"]);
  });

  it("reports bad and repeated addresses rather than guessing", () => {
    const r = readContacts("Email,Name\nnot-an-email,A\nb@example.com,B\nB@example.com,B again\n,C");
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicates).toBe(1);
    expect(r.invalid.map((x) => x.line)).toEqual([2, 5]);
  });

  it("says so when there's no email column, or too many rows", () => {
    expect(readContacts("Name,Phone\nJo,0400")).toHaveProperty("error");
    expect(readContacts("Email\na@example.com\nb@example.com", 1)).toHaveProperty("error");
  });
});

describe("dates from a spreadsheet", () => {
  it("reads Australian day-first dates and ISO, and refuses impossible ones", () => {
    expect(toIsoDate("14/02/2027")).toBe("2027-02-14");
    expect(toIsoDate("1-3-27")).toBe("2027-03-01");
    expect(toIsoDate("2027-02-14")).toBe("2027-02-14");
    expect(toIsoDate("31/02/2027")).toBeNull();
    expect(toIsoDate("next week")).toBeNull();
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });

  it("picks up a key-date column named after the field", () => {
    const r = readContacts(
      "Email,Fixed rate ends\na@example.com,14/02/2027\nb@example.com,soon\nc@example.com,",
      5000,
      [{ id: "fixed-rate-expiry", label: "Fixed rate ends" }],
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.rows[0].dates).toEqual({ "fixed-rate-expiry": "2027-02-14" });
    expect(r.rows[1].dates).toBeUndefined();
    expect(r.dateColumns).toEqual([
      { fieldId: "fixed-rate-expiry", label: "Fixed rate ends", heading: "Fixed rate ends", filled: 1, unreadable: 1 },
    ]);
  });
});

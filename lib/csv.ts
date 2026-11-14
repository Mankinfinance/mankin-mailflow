/**
 * CSV for spreadsheets, safely.
 *
 * Every export from Mailflow is opened in Excel or Google Sheets, and a
 * spreadsheet runs a cell that starts with =, +, - or @ as a formula.
 * Some of these values were typed by strangers (a name on a public
 * form), so "=HYPERLINK(...)" in a name would become a live formula on
 * a broker's machine. Such cells get a leading apostrophe, which the
 * spreadsheet shows as text and hides.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  /* A byte-order mark so Excel reads it as UTF-8 (names with accents),
     and CRLF line ends, which is what RFC 4180 and Excel expect. */
  return (
    "﻿" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

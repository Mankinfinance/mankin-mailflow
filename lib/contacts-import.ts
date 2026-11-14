/**
 * Reading a contact list someone exported from a spreadsheet, a CRM or
 * another email tool, so it can be added to Mailflow's own list.
 *
 * Pure, so it runs in the browser for the preview and again on the
 * server, which never trusts what the browser sends.
 */

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines
 *  inside quotes, CRLF or LF. Also accepts semicolons or tabs when the
 *  first line has more of those than commas (Excel in some locales). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [",", ";", "\t"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportRow {
  email: string;
  name: string;
  phone: string;
  /** Key dates by field id (YYYY-MM-DD), from columns named after them. */
  dates?: Record<string, string>;
}

export interface ImportPreview {
  rows: ImportRow[];
  /** Lines with no usable email address, with the line number. */
  invalid: Array<{ line: number; value: string }>;
  /** Addresses that appeared more than once in the file. */
  duplicates: number;
  /** Which columns were used, for the preview to say so. */
  columns: { email: string; name: string | null; phone: string | null };
  /** Key-date columns found, with how many rows had a readable date. */
  dateColumns?: Array<{ fieldId: string; label: string; heading: string; filled: number; unreadable: number }>;
}

const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Find the email, name and phone columns by their headings, the way a
 * person would. Without a heading row, the first column holding an
 * address is the email and the one before or after it the name.
 */
export function readContacts(
  text: string,
  maxRows = 5000,
  dateFields: Array<{ id: string; label: string }> = [],
): ImportPreview | { error: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { error: "That file is empty." };

  const header = table[0].map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  let emailCol = find("email", "emailaddress", "mail", "e", "emailaddr");
  const hasHeader = emailCol >= 0;
  if (!hasHeader) {
    emailCol = table[0].findIndex((c) => isEmail(c));
    if (emailCol < 0) return { error: "Couldn't find a column of email addresses. Add a heading called Email." };
  }

  const nameCol = hasHeader ? find("name", "fullname", "contactname", "clientname") : emailCol === 0 ? (table[0].length > 1 ? 1 : -1) : 0;
  const firstCol = hasHeader ? find("firstname", "first", "givenname", "fname") : -1;
  const lastCol = hasHeader ? find("lastname", "last", "surname", "familyname", "lname") : -1;
  const phoneCol = hasHeader ? find("phone", "mobile", "phonenumber", "mobilenumber", "mobilephone", "cell") : -1;

  const dateCols = hasHeader
    ? dateFields.flatMap((f) => {
        const i = header.findIndex((h) => h === norm(f.label) || h === norm(f.id));
        return i >= 0 ? [{ field: f, col: i, filled: 0, unreadable: 0 }] : [];
      })
    : [];

  const body = hasHeader ? table.slice(1) : table;
  if (body.length > maxRows) {
    return { error: `That's ${body.length} rows. Import up to ${maxRows} at a time.` };
  }

  const rows: ImportRow[] = [];
  const invalid: ImportPreview["invalid"] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  body.forEach((r, i) => {
    const raw = (r[emailCol] ?? "").trim().replace(/^mailto:/i, "");
    const line = i + (hasHeader ? 2 : 1);
    if (!isEmail(raw)) {
      invalid.push({ line, value: raw.slice(0, 80) });
      return;
    }
    const email = raw.toLowerCase();
    if (seen.has(email)) {
      duplicates += 1;
      return;
    }
    seen.add(email);
    const joined = [firstCol >= 0 ? r[firstCol] : "", lastCol >= 0 ? r[lastCol] : ""]
      .map((x) => (x ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const name = (nameCol >= 0 ? (r[nameCol] ?? "").trim() : "") || joined;
    const dates: Record<string, string> = {};
    for (const dc of dateCols) {
      const raw = (r[dc.col] ?? "").trim();
      if (!raw) continue;
      const iso = toIsoDate(raw);
      if (iso) {
        dates[dc.field.id] = iso;
        dc.filled += 1;
      } else dc.unreadable += 1;
    }
    rows.push({
      email,
      name: name.slice(0, 120),
      phone: (phoneCol >= 0 ? (r[phoneCol] ?? "").trim() : "").slice(0, 40),
      ...(Object.keys(dates).length ? { dates } : {}),
    });
  });

  const label = (i: number) => (i < 0 ? null : hasHeader ? table[0][i] : `column ${i + 1}`);
  return {
    rows,
    invalid,
    duplicates,
    columns: {
      email: label(emailCol) ?? "email",
      name: label(nameCol) ?? (firstCol >= 0 || lastCol >= 0 ? [label(firstCol), label(lastCol)].filter(Boolean).join(" + ") : null),
      phone: label(phoneCol),
    },
    dateColumns: dateCols.map((d) => ({
      fieldId: d.field.id,
      label: d.field.label,
      heading: table[0][d.col],
      filled: d.filled,
      unreadable: d.unreadable,
    })),
  };
}

/** A real YYYY-MM-DD date between 1900 and 2100 (no 31 February). */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Australian-style or ISO dates from a spreadsheet: 14/02/2027,
 *  14-2-27, 2027-02-14. Day first, as Australians write it. */
export function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (isCalendarDate(v)) return v;
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isCalendarDate(iso) ? iso : null;
}

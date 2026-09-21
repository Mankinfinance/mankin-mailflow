import "server-only";
import * as XLSX from "xlsx";

/**
 * Parse the monthly YBR Aggregation commission XLSX (e.g.
 * "Mankin Finance Commission April 2026.xlsx") into a flat list of
 * settled deal records — the back-book the CX manager runs anniversary
 * reviews over.
 *
 * Sheets we consume (others ignored):
 *  - "Upfront Details"  → newly settled deals in this month's RCTI
 *  - "Trail Details"    → every still-active loan on trail (the back-book)
 *  - "Clawback Details" → deals that have refinanced away
 *
 * The Upfront and Trail sheets share the same column shape:
 *   Broker Name, Company Name, ABN, Lender, Lender Code, Client,
 *   Loan ID, Reference, Loan Balance/Amount, Settlement Amount,
 *   Settlement Date, Gross Commission (ex GST), Gross Commission (GST),
 *   Total Gross Commission (inc GST), Net Commission (ex GST),
 *   Net Commission GST, Total Net Commission Remitted, Split Code,
 *   Broker %, Loan Status, Arrears Date, Discharge Date
 *
 * Settlement Date arrives as an Excel serial number (e.g. 46128). We
 * convert it to an ISO date string. Same for Discharge Date when
 * present (clawback rows).
 *
 * Dedup: the same Loan ID can appear on both Upfront (this month) and
 * Trail (every month). Upfront wins because it carries the upfront
 * commission figure; trail rows for the same loan are merged in to
 * supply the monthly trail commission.
 */

export interface SettlementRow {
  /** Stable id derived from the Loan ID — unique across the back-book. */
  id: string;

  /** Broker name from the spreadsheet (the broker who wrote the loan). */
  brokerName: string;
  /** Best-effort match to a TEAM member id; null when unmatched. */
  brokerId: string | null;

  /** Customer name (Last, First format normalised to "First Last"). */
  clientName: string;
  /** Customer contact email, when the commission sheet carries one.
   *  Empty string when absent. Powers CX outreach (anniversary + refinance
   *  emails) so those can address the customer directly instead of the
   *  broker pasting the address in by hand. */
  email: string;
  /** Lender (e.g. "Hemisphere - Resimac", "ANZ", "CBA"). */
  lender: string;
  /** Lender short code (e.g. "HMS", "ANZ", "CBA"). */
  lenderCode: string;
  /** Lender's loan id — for finding the deal in the lender portal. */
  loanId: string;
  /** Settlement date as ISO yyyy-mm-dd. */
  settlementDate: string;
  /** Loan amount at settlement (AUD). */
  settlementAmount: number;
  /** Current loan balance at the report date (AUD). */
  currentBalance: number;

  /** Net upfront commission paid to the broker on settlement. */
  upfrontCommission: number;
  /** Net trail commission paid this month for this loan. */
  monthlyTrail: number;
  /** Active | closed | discharged — informs whether the loan is still
   *  on the back-book or has refinanced away. */
  loanStatus: "active" | "closed" | "discharged" | "unknown";
  /** Discharge date as ISO when status is closed/discharged. */
  dischargeDate: string | null;

  /** Provenance flags so we can filter the table cleanly. */
  source: {
    onUpfront: boolean;
    onTrail: boolean;
    onClawback: boolean;
  };
}

export interface CommissionImportResult {
  /** Deduplicated rows ready to persist. */
  rows: SettlementRow[];
  /** Per-sheet stats so the import UI can show what landed. */
  sheets: {
    upfront: number;
    trail: number;
    clawback: number;
  };
  /** How many settlements ended up with a contact email — lets the import
   *  UI confirm the tie-in worked and flag when the sheet had none. */
  emailsFound: number;
  /** Diagnostic warnings — bad date formats, missing client names, etc. */
  warnings: string[];
}

/** Strip everything but letters and digits so header spelling variants
 *  collapse to one key: "Client E-Mail", "Client Email" and "client_email"
 *  all become "clientemail". */
function normaliseHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Email column headers as normalised keys. The YBR sheet uses
 *  "Client E-Mail" (hyphenated) on the Trail sheet — normalising means we
 *  match it without having to enumerate every punctuation variant. */
const EMAIL_HEADER_KEYS = new Set(
  [
    "email",
    "email address",
    "e-mail",
    "client email",
    "client e-mail",
    "customer email",
    "contact email",
    "borrower email",
  ].map(normaliseHeader),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pull a valid-looking email from whichever email column the sheet uses,
 *  tolerant of header punctuation; returns "" when absent or malformed. */
function readEmail(
  row: unknown[],
  idx: Record<string, number>,
): string {
  for (const [header, i] of Object.entries(idx)) {
    if (!EMAIL_HEADER_KEYS.has(normaliseHeader(header))) continue;
    const raw = String(row[i] ?? "").trim().toLowerCase();
    if (raw && EMAIL_RE.test(raw)) return raw;
  }
  return "";
}

/** Excel epoch → ISO date string (yyyy-mm-dd). */
function excelSerialToIso(serial: number | string | null | undefined): string | null {
  if (serial == null || serial === "") return null;
  const n = typeof serial === "number" ? serial : Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Excel epoch: 1899-12-30 (accounts for Excel's leap-year bug for 1900).
  const epochMs = Date.UTC(1899, 11, 30);
  const ms = epochMs + n * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // yyyy-mm-dd
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Spreadsheet uses "LAST, First Middle" — flip to "First Last" + title-case. */
function normaliseClientName(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (!t) return "";
  if (t.includes(",")) {
    const [last, first] = t.split(",", 2).map((s) => s.trim());
    if (last && first) return titleCase(`${first} ${last}`);
  }
  return titleCase(t);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/\b(Pty|Ltd|Smsf|Atf)\b/gi, (m) => m.toUpperCase());
}

function normaliseLoanStatus(raw: string): SettlementRow["loanStatus"] {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "active") return "active";
  if (t === "closed") return "closed";
  if (t.includes("discharge")) return "discharged";
  return "unknown";
}

/** Build a flat-key column lookup tolerant of small naming variations. */
function buildHeaderIndex(headers: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (typeof h === "string" && h.trim().length > 0) {
      out[h.trim().toLowerCase()] = i;
    }
  });
  return out;
}

function parseRows(
  sheet: XLSX.WorkSheet,
  source: "upfront" | "trail" | "clawback",
): {
  records: ParsedRecord[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  });
  if (rows.length < 2) return { records: [], warnings };

  const headers = rows[0];
  const idx = buildHeaderIndex(headers);
  const records: ParsedRecord[] = [];

  const col = (row: unknown[], label: string): unknown => {
    const i = idx[label.toLowerCase()];
    if (i === undefined) return null;
    return row[i] ?? null;
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v == null || v === "")) continue;

    const clientRaw = String(col(row, "Client") ?? "").trim();
    if (!clientRaw) continue;

    const loanIdRaw = String(col(row, "Loan ID") ?? "").trim();
    if (!loanIdRaw) {
      warnings.push(`${source} row ${r + 1}: missing Loan ID for "${clientRaw}"`);
      continue;
    }

    const settlementSerial = col(row, "Settlement Date");
    const settlementDate = excelSerialToIso(
      settlementSerial as number | string | null,
    );
    if (!settlementDate && source !== "clawback") {
      warnings.push(`${source} row ${r + 1}: unreadable Settlement Date for "${clientRaw}"`);
    }

    const dischargeDate = excelSerialToIso(
      col(row, "Discharge Date") as number | string | null,
    );

    records.push({
      brokerName: String(col(row, "Broker Name") ?? "").trim(),
      clientName: normaliseClientName(clientRaw),
      email: readEmail(row, idx),
      lender: String(col(row, "Lender") ?? "").trim(),
      lenderCode: String(col(row, "Lender Code") ?? "").trim(),
      loanId: loanIdRaw,
      settlementDate: settlementDate ?? "",
      settlementAmount: Number(col(row, "Settlement Amount") ?? 0) || 0,
      currentBalance: Number(col(row, "Loan Balance/Amount") ?? 0) || 0,
      netCommission:
        Number(col(row, "Total Net Commission Remitted") ?? 0) || 0,
      loanStatus: normaliseLoanStatus(String(col(row, "Loan Status") ?? "")),
      dischargeDate,
      source,
    });
  }
  return { records, warnings };
}

interface ParsedRecord {
  brokerName: string;
  clientName: string;
  email: string;
  lender: string;
  lenderCode: string;
  loanId: string;
  settlementDate: string;
  settlementAmount: number;
  currentBalance: number;
  /** Differs by source: upfront row → upfront commission; trail row →
   *  monthly trail; clawback row → negative number. */
  netCommission: number;
  loanStatus: SettlementRow["loanStatus"];
  dischargeDate: string | null;
  source: "upfront" | "trail" | "clawback";
}

/** Map a broker name to a TEAM member id — best-effort. */
function matchBrokerName(name: string): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  // Lazy import to keep this module server-only-friendly.
  // Hardcoded fallback so we don't introduce a circular dep.
  if (n.includes("michael") && n.includes("mankin")) return "mm";
  if (n.includes("nathan") && n.includes("austin")) return "na";
  if (n.includes("robert") && n.includes("lombardo")) return "rl";
  if (n.includes("dylan") && n.includes("shacallis")) return "ds";
  if (n.includes("nick") && n.includes("nissan")) return "nn";
  if (n.includes("maddison") && n.includes("phillips")) return "mp";
  return null;
}

export function parseCommissionWorkbook(
  buffer: ArrayBuffer | Buffer | Uint8Array,
): CommissionImportResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const warnings: string[] = [];
  const byLoanId = new Map<string, SettlementRow>();
  const counts = { upfront: 0, trail: 0, clawback: 0 };

  const sourceSheets: Array<["upfront" | "trail" | "clawback", string]> = [
    ["upfront", "Upfront Details"],
    ["trail", "Trail Details"],
    ["clawback", "Clawback Details"],
  ];

  for (const [source, sheetName] of sourceSheets) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      warnings.push(`Sheet "${sheetName}" not found — skipping.`);
      continue;
    }
    const { records, warnings: w } = parseRows(sheet, source);
    warnings.push(...w);
    counts[source] = records.length;

    for (const rec of records) {
      const existing = byLoanId.get(rec.loanId);
      if (!existing) {
        byLoanId.set(rec.loanId, {
          id: rec.loanId,
          brokerName: rec.brokerName,
          brokerId: matchBrokerName(rec.brokerName),
          clientName: rec.clientName,
          email: rec.email,
          lender: rec.lender,
          lenderCode: rec.lenderCode,
          loanId: rec.loanId,
          settlementDate: rec.settlementDate,
          settlementAmount: rec.settlementAmount,
          currentBalance: rec.currentBalance,
          upfrontCommission: source === "upfront" ? rec.netCommission : 0,
          monthlyTrail: source === "trail" ? rec.netCommission : 0,
          loanStatus: rec.loanStatus,
          dischargeDate: rec.dischargeDate,
          source: {
            onUpfront: source === "upfront",
            onTrail: source === "trail",
            onClawback: source === "clawback",
          },
        });
      } else {
        // Merge: prefer non-empty fields; sum commissions per source.
        if (source === "upfront" && rec.netCommission)
          existing.upfrontCommission = rec.netCommission;
        if (source === "trail" && rec.netCommission)
          existing.monthlyTrail = rec.netCommission;
        if (source === "clawback") {
          // Clawback signals the loan refinanced away — flip status.
          existing.loanStatus = rec.loanStatus !== "unknown"
            ? rec.loanStatus
            : "closed";
          if (rec.dischargeDate) existing.dischargeDate = rec.dischargeDate;
        }
        existing.source.onUpfront ||= source === "upfront";
        existing.source.onTrail ||= source === "trail";
        existing.source.onClawback ||= source === "clawback";
        // Upgrade fields when the trail/clawback row has data the upfront
        // row didn't (e.g. settlement date populated on trail but not on
        // the freshly-settled-but-not-yet-paid upfront row).
        if (!existing.settlementDate && rec.settlementDate)
          existing.settlementDate = rec.settlementDate;
        // Keep the first email we see for this loan across any sheet.
        if (!existing.email && rec.email) existing.email = rec.email;
        if (!existing.lender && rec.lender) existing.lender = rec.lender;
        if (!existing.brokerId && rec.brokerName) {
          existing.brokerName = rec.brokerName;
          existing.brokerId = matchBrokerName(rec.brokerName);
        }
      }
    }
  }

  const rows = Array.from(byLoanId.values()).sort((a, b) =>
    b.settlementDate.localeCompare(a.settlementDate),
  );
  const emailsFound = rows.reduce((n, r) => (r.email ? n + 1 : n), 0);
  return { rows, sheets: counts, emailsFound, warnings };
}

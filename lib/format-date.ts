/**
 * Australian date formatting — one place so every surface reads DD/MM/YYYY.
 *
 * Two value kinds need different handling:
 *
 *  - DATE-ONLY strings ("YYYY-MM-DD", e.g. a DOB, a settlement date from a
 *    <input type=date>). These must be reformatted as a STRING. Never
 *    new Date()-parse them: "2026-09-03" parses as UTC midnight, which in AU
 *    time is still the 3rd, but the reverse (a date near month/day
 *    boundaries) can shift a day. String reformat is exact.
 *
 *  - TIMESTAMPS (a real Date, or an ISO datetime). Format via the en-AU
 *    locale anchored to Sydney, so the calendar day is correct even when the
 *    server runs in UTC (Vercel).
 *
 * Pure + isomorphic (no server-only) so client components can use it too.
 */

const AU_TZ = "Australia/Sydney";

/** Reformat a date-only "YYYY-MM-DD" string to "DD/MM/YYYY". Returns the
 *  input unchanged if it isn't a YYYY-MM-DD prefix (and "" for empty). */
export function formatDateAU(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** Format a timestamp (Date | ISO datetime | epoch) as "DD/MM/YYYY",
 *  Sydney-anchored. Returns "" (or the original string) for invalid input. */
export function formatTimestampAU(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: AU_TZ,
  });
}

/** Format a timestamp as "DD/MM/YYYY, h:mm am", Sydney-anchored. */
export function formatTimestampTimeAU(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
  return d.toLocaleString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: AU_TZ,
  });
}

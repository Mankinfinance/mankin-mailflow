import type { Deal } from "@/lib/clients/salestrekker/types";

/**
 * The customer email addresses for a deal.
 *
 * `to` is the primary applicant's address (deal.email). `cc` is every other
 * address on the deal — the optional secondaryEmail for a combined
 * "A & B" applicant, plus any co-applicant records (applicants[1..]) —
 * deduped case-insensitively and with the primary removed.
 *
 * Both partners on a joint application stay in the loop on every customer
 * email without the broker having to CC by hand.
 */
export function customerEmailRecipients(
  deal: Pick<Deal, "email" | "secondaryEmail" | "applicants">,
): { to: string; cc: string[] } {
  const to = (deal.email ?? "").trim();
  const seen = new Set<string>();
  if (to) seen.add(to.toLowerCase());

  const cc: string[] = [];
  const candidates = [
    deal.secondaryEmail ?? "",
    ...(deal.applicants ?? []).slice(1).map((a) => a.email ?? ""),
  ];
  for (const raw of candidates) {
    const e = raw.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cc.push(e);
  }
  return { to, cc };
}

/**
 * Merge the deal's extra customer addresses into an existing CC string.
 * Accepts whatever CC a caller already set (comma/semicolon separated),
 * appends the deal's secondary + co-applicant addresses, dedupes
 * case-insensitively, and returns a comma-joined line ("" when empty).
 * Comma matches both the Graph recipients() splitter and RFC 6068 mailto.
 */
export function mergeCustomerCc(
  deal: Pick<Deal, "email" | "secondaryEmail" | "applicants">,
  existingCc = "",
): string {
  const { cc } = customerEmailRecipients(deal);
  const existing = existingCc
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const e of [...existing, ...cc]) {
    const key = e.toLowerCase();
    if (!e || seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  return merged.join(", ");
}

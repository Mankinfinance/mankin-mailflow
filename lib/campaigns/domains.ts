/**
 * Engagement broken down by the recipient's mail provider.
 *
 * This exists because the usual sources do not work at this size.
 * Google Postmaster Tools needs roughly a hundred messages a day to a
 * distinct Gmail volume before it shows anything; SNDS and JMRP are
 * keyed on sending IP, and Exchange Online's outbound pool is shared,
 * so neither applies. See docs/deliverability.md.
 *
 * What is left is the firm's own send data, and it answers the question
 * that matters: is one provider treating us differently from the rest?
 * A campaign opening at 55% on Bigpond and 11% on Gmail is not a
 * content problem, and no aggregate open rate would ever show it.
 *
 * Pure module — recipients in, rows out — so the arithmetic is testable
 * without a database.
 */

/**
 * Minimum recipients before a rate is shown at all.
 *
 * Twenty is not a statistical ceremony, it is a floor below which the
 * number misleads: on eight recipients a single extra open moves the
 * rate twelve points, and a broker reading "37.5%" has no way to see
 * that. Below this the count is shown and the rate is withheld.
 */
export const MIN_FOR_RATE = 20;

/**
 * Consumer providers worth grouping, because their filtering decisions
 * are made centrally and a per-domain split would hide that. Outlook,
 * Hotmail and Live are one filter; showing them apart would divide the
 * evidence three ways.
 */
const PROVIDER_GROUPS: Array<{ label: string; domains: string[] }> = [
  { label: "Gmail", domains: ["gmail.com", "googlemail.com"] },
  {
    label: "Outlook / Hotmail",
    domains: ["outlook.com", "outlook.com.au", "hotmail.com", "hotmail.com.au", "live.com", "live.com.au", "msn.com"],
  },
  { label: "Bigpond / Telstra", domains: ["bigpond.com", "bigpond.net.au", "telstra.com", "telstra.com.au"] },
  { label: "Yahoo", domains: ["yahoo.com", "yahoo.com.au", "ymail.com", "rocketmail.com"] },
  { label: "iCloud", domains: ["icloud.com", "me.com", "mac.com"] },
  { label: "Optus", domains: ["optusnet.com.au", "optus.com.au"] },
  { label: "iiNet / TPG", domains: ["iinet.net.au", "tpg.com.au", "internode.on.net", "westnet.com.au"] },
];

const DOMAIN_TO_PROVIDER = new Map<string, string>();
for (const group of PROVIDER_GROUPS) {
  for (const domain of group.domains) DOMAIN_TO_PROVIDER.set(domain, group.label);
}

/** The label a given address is counted under. */
export function providerFor(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "Other";
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return "Other";
  return DOMAIN_TO_PROVIDER.get(domain) ?? "Other";
}

export interface DomainRow {
  provider: string;
  /** Successfully handed to the mail server. The denominator. */
  sent: number;
  opened: number;
  clicked: number;
  /** Rejected at send — a hard bounce shows up here. */
  failed: number;
  /** Null when `sent` is under MIN_FOR_RATE: not zero, unknown. */
  openRate: number | null;
  clickRate: number | null;
  /** How many distinct domains this row covers. Only ever >1 for "Other". */
  distinctDomains: number;
}

export interface DomainBreakdown {
  rows: DomainRow[];
  /** Open rate across every provider with a readable sample, for the
   *  comparison line. Null when no provider reaches the floor. */
  baselineOpenRate: number | null;
  /** True when at least one readable provider sits well below the rest. */
  hasOutlier: boolean;
}

export interface DomainRecipientInput {
  email: string;
  status: string;
  openedAt: Date | null;
  clickedAt: Date | null;
}

/**
 * Build the breakdown, busiest provider first.
 *
 * Only recipients that actually went out are counted. A skipped
 * recipient — suppressed, or a duplicate address — never reached a
 * provider, and including them would make every rate look worse than
 * the send really was.
 */
export function buildDomainBreakdown(
  recipients: DomainRecipientInput[],
): DomainBreakdown {
  const acc = new Map<
    string,
    { sent: number; opened: number; clicked: number; failed: number; domains: Set<string> }
  >();

  for (const r of recipients) {
    if (r.status !== "sent" && r.status !== "failed") continue;

    const provider = providerFor(r.email);
    const at = r.email.lastIndexOf("@");
    const domain = at < 0 ? "" : r.email.slice(at + 1).toLowerCase().trim();

    let row = acc.get(provider);
    if (!row) {
      row = { sent: 0, opened: 0, clicked: 0, failed: 0, domains: new Set() };
      acc.set(provider, row);
    }
    if (domain) row.domains.add(domain);

    if (r.status === "failed") {
      row.failed += 1;
      continue;
    }
    row.sent += 1;
    if (r.openedAt) row.opened += 1;
    if (r.clickedAt) row.clicked += 1;
  }

  const rows: DomainRow[] = [...acc.entries()]
    .map(([provider, v]) => ({
      provider,
      sent: v.sent,
      opened: v.opened,
      clicked: v.clicked,
      failed: v.failed,
      openRate: v.sent >= MIN_FOR_RATE ? (v.opened / v.sent) * 100 : null,
      clickRate: v.sent >= MIN_FOR_RATE ? (v.clicked / v.sent) * 100 : null,
      distinctDomains: v.domains.size,
    }))
    .sort((a, b) => b.sent - a.sent || a.provider.localeCompare(b.provider));

  /* The baseline is every readable provider pooled, not the mean of
     their rates — a provider with 300 recipients and one with 25 should
     not carry equal weight in the number the others are compared to. */
  const readable = rows.filter((r) => r.openRate !== null);
  const pooledSent = readable.reduce((sum, r) => sum + r.sent, 0);
  const pooledOpened = readable.reduce((sum, r) => sum + r.opened, 0);
  const baselineOpenRate = pooledSent > 0 ? (pooledOpened / pooledSent) * 100 : null;

  /* "Well below" is deliberately a wide gap. Providers differ by a few
     points for ordinary reasons — image blocking, app defaults — and a
     line that cries filtering at every wobble stops being read. */
  const hasOutlier =
    baselineOpenRate !== null &&
    readable.some((r) => r.openRate !== null && r.openRate < baselineOpenRate / 2);

  return { rows, baselineOpenRate, hasOutlier };
}

/** What the outlier line should say, or null when there is nothing to say. */
export function describeOutlier(breakdown: DomainBreakdown): string | null {
  if (!breakdown.hasOutlier || breakdown.baselineOpenRate === null) return null;

  const worst = breakdown.rows
    .filter((r) => r.openRate !== null)
    .sort((a, b) => (a.openRate ?? 0) - (b.openRate ?? 0))[0];
  if (!worst || worst.openRate === null) return null;

  return (
    `${worst.provider} opened at ${worst.openRate.toFixed(1)}% against ` +
    `${breakdown.baselineOpenRate.toFixed(1)}% everywhere else. That gap is ` +
    `usually filtering rather than content — check SPF, DKIM and DMARC, and ` +
    `keep an eye on it across the next few sends before changing anything.`
  );
}

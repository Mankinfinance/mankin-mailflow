import { promises as dns } from "node:dns";

/**
 * Is the sending domain set up so inbox providers trust it?
 *
 * Read from public DNS rather than typed into a form, because a form
 * would only repeat back what someone believed. Four answers, each with
 * the fix in words a person can act on:
 *
 *   SPF   — Microsoft 365 is allowed to send for the domain.
 *   DKIM  — Microsoft 365 signs as the domain (selector1/selector2).
 *           Without it, mail is signed as the tenant's onmicrosoft.com
 *           address, DMARC rests on SPF alone, and any forward breaks it.
 *   DMARC — a policy exists, and whether it asks receivers to act.
 *   Links — tracked links and images point at the firm's own domain,
 *           not a shared *.vercel.app one, which filters score on its
 *           neighbours' behaviour.
 *
 * `evaluateSenderAuth` is pure so every branch is testable without DNS;
 * `checkSenderAuth` does the lookups and caches them.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface AuthCheck {
  key: "spf" | "dkim" | "dmarc" | "links";
  label: string;
  status: CheckStatus;
  /** What was found, in a sentence. */
  detail: string;
  /** What to do about it. Empty when nothing needs doing. */
  fix: string;
  /** The raw record, when there is one, for the person fixing it. */
  record?: string;
}

export interface SenderAuth {
  domain: string;
  checks: AuthCheck[];
  /** SPF and DKIM pass and a DMARC record exists. */
  authenticated: boolean;
  checkedAt: string;
}

/** A lookup result: the records, "none" for NXDOMAIN/NODATA, or
 *  "error" when DNS itself could not be reached. */
export type Lookup<T> = T | "none" | "error";

export interface SenderRecords {
  domain: string;
  txt: Lookup<string[]>;
  dmarc: Lookup<string[]>;
  selector1: Lookup<string>;
  selector2: Lookup<string>;
  /** NEXT_PUBLIC_APP_URL, which every tracked link and image uses. */
  appUrl: string | undefined;
}

const MICROSOFT_SPF = "include:spf.protection.outlook.com";

function spfCheck(txt: Lookup<string[]>, domain: string): AuthCheck {
  const base = { key: "spf" as const, label: "SPF" };
  if (txt === "error") {
    return { ...base, status: "unknown", detail: "DNS could not be reached.", fix: "" };
  }
  const records = txt === "none" ? [] : txt.filter((r) => /^v=spf1\b/i.test(r.trim()));
  if (records.length === 0) {
    return {
      ...base,
      status: "fail",
      detail: `${domain} has no SPF record.`,
      fix: `Add a TXT record at ${domain}: v=spf1 ${MICROSOFT_SPF} -all`,
    };
  }
  if (records.length > 1) {
    return {
      ...base,
      status: "fail",
      detail: "There are two SPF records, so receivers treat SPF as broken.",
      fix: "Merge them into one TXT record starting v=spf1.",
      record: records.join(" | "),
    };
  }
  const record = records[0].trim();
  if (!record.toLowerCase().includes(MICROSOFT_SPF)) {
    return {
      ...base,
      status: "fail",
      detail: "SPF does not allow Microsoft 365, which is what sends Mailflow's email.",
      fix: `Add ${MICROSOFT_SPF} to the SPF record, before the final "all".`,
      record,
    };
  }
  if (/[+?]all\b/i.test(record) || !/[-~]all\b/i.test(record)) {
    return {
      ...base,
      status: "warn",
      detail: "SPF allows Microsoft 365 but does not say what to do with anyone else.",
      fix: 'End the record with "-all".',
      record,
    };
  }
  return {
    ...base,
    status: "pass",
    detail: "Microsoft 365 is allowed to send for the domain.",
    fix: "",
    record,
  };
}

function dkimCheck(
  s1: Lookup<string>,
  s2: Lookup<string>,
  domain: string,
): AuthCheck {
  const base = { key: "dkim" as const, label: "DKIM" };
  if (s1 === "error" || s2 === "error") {
    return { ...base, status: "unknown", detail: "DNS could not be reached.", fix: "" };
  }
  if (s1 === "none" || s2 === "none") {
    return {
      ...base,
      status: "fail",
      detail: `Microsoft 365 is not signing mail as ${domain}. It signs as the tenant's onmicrosoft.com address instead, which weakens every email.`,
      fix: `In Microsoft Defender (security.microsoft.com) → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM, open ${domain}, add the two CNAME records it shows (selector1 and selector2) at your DNS host, then switch "Sign messages for this domain with DKIM signatures" on.`,
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `Microsoft 365 signs mail as ${domain}.`,
    fix: "",
    record: `selector1 → ${s1}`,
  };
}

function dmarcCheck(dmarc: Lookup<string[]>, domain: string, dkimOk: boolean): AuthCheck {
  const base = { key: "dmarc" as const, label: "DMARC" };
  if (dmarc === "error") {
    return { ...base, status: "unknown", detail: "DNS could not be reached.", fix: "" };
  }
  const record =
    dmarc === "none" ? undefined : dmarc.find((r) => /^v=DMARC1\b/i.test(r.trim()));
  if (!record) {
    return {
      ...base,
      status: "fail",
      detail: `${domain} has no DMARC record. Gmail and Yahoo require one for bulk mail.`,
      fix: `Add a TXT record at _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    };
  }
  const policy = /\bp=(\w+)/i.exec(record)?.[1]?.toLowerCase() ?? "none";
  if (policy === "none") {
    return {
      ...base,
      status: "warn",
      detail: "DMARC is monitoring only (p=none), so nothing stops someone sending as the domain.",
      fix: dkimOk
        ? "Once reports have shown clean for two to four weeks, change p=none to p=quarantine."
        : "Fix DKIM first. Then, after two to four clean weeks, change p=none to p=quarantine.",
      record: record.trim(),
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `DMARC asks receivers to ${policy === "reject" ? "reject" : "quarantine"} mail that fails.`,
    fix: "",
    record: record.trim(),
  };
}

function linksCheck(appUrl: string | undefined, domain: string): AuthCheck {
  const base = { key: "links" as const, label: "Link domain" };
  let host = "";
  try {
    host = appUrl ? new URL(appUrl).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  if (!host || host === "localhost") {
    return {
      ...base,
      status: "fail",
      detail: "NEXT_PUBLIC_APP_URL is not set, so links in emails will not work.",
      fix: "Set NEXT_PUBLIC_APP_URL in Vercel to the address Mailflow is served from.",
    };
  }
  const root = domain.toLowerCase();
  const ownDomain =
    host === root ||
    host.endsWith(`.${root}`) ||
    // mankinfinance.com and mankinfinance.com.au are the same firm.
    host.endsWith(`.${root}.au`) ||
    host.endsWith(`.${root.replace(/\.au$/, "")}`);
  if (host.endsWith(".vercel.app")) {
    return {
      ...base,
      status: "warn",
      detail: `Links and images in emails point at ${host}, a shared address filters judge by everyone else using it.`,
      fix: `Add a subdomain such as mail.${root} to the project in Vercel (Settings → Domains), add the CNAME it gives you, then set NEXT_PUBLIC_APP_URL to https://mail.${root} and redeploy.`,
    };
  }
  if (!ownDomain) {
    return {
      ...base,
      status: "warn",
      detail: `Links point at ${host}, which does not match the sending domain.`,
      fix: `Serve Mailflow from a subdomain of ${root} and set NEXT_PUBLIC_APP_URL to it.`,
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `Links and images point at ${host}, the firm's own domain.`,
    fix: "",
  };
}

export function evaluateSenderAuth(
  records: SenderRecords,
  now: Date = new Date(),
): SenderAuth {
  const spf = spfCheck(records.txt, records.domain);
  const dkim = dkimCheck(records.selector1, records.selector2, records.domain);
  const dmarc = dmarcCheck(records.dmarc, records.domain, dkim.status === "pass");
  const links = linksCheck(records.appUrl, records.domain);
  return {
    domain: records.domain,
    checks: [spf, dkim, dmarc, links],
    authenticated:
      spf.status === "pass" && dkim.status === "pass" && dmarc.status !== "fail",
    checkedAt: now.toISOString(),
  };
}

/* ---------- Lookups ---------- */

const MISSING = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const TIMEOUT_MS = 3000;

async function lookup<T>(run: () => Promise<T>): Promise<Lookup<T>> {
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    return MISSING.has(code) ? "none" : "error";
  }
}

const joinTxt = (rows: string[][]) => rows.map((chunks) => chunks.join(""));

async function lookupDkim(host: string): Promise<Lookup<string>> {
  // Microsoft's records are CNAMEs; a TXT published directly works too.
  const cname = await lookup(() => dns.resolveCname(host));
  if (cname !== "none" && cname !== "error" && cname.length > 0) return cname[0];
  const txt = await lookup(() => dns.resolveTxt(host));
  if (txt !== "none" && txt !== "error" && txt.length > 0) return joinTxt(txt)[0];
  return cname === "error" && txt === "error" ? "error" : "none";
}

export async function lookupSenderRecords(domain: string): Promise<SenderRecords> {
  const [txt, dmarc, selector1, selector2] = await Promise.all([
    lookup(() => dns.resolveTxt(domain).then(joinTxt)),
    lookup(() => dns.resolveTxt(`_dmarc.${domain}`).then(joinTxt)),
    lookupDkim(`selector1._domainkey.${domain}`),
    lookupDkim(`selector2._domainkey.${domain}`),
  ]);
  return {
    domain,
    txt,
    dmarc,
    selector1,
    selector2,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}

/* DNS changes slowly and the dashboard renders often, so one answer is
   kept for a while. A result with an unreachable lookup is kept only
   briefly, so a network blip does not stick. */
const CACHE_MS = 30 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const cache = new Map<string, { at: number; value: SenderAuth }>();

export async function checkSenderAuth(
  domain: string,
  opts: { fresh?: boolean } = {},
): Promise<SenderAuth> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && !opts.fresh) {
    const unknown = hit.value.checks.some((c) => c.status === "unknown");
    if (Date.now() - hit.at < (unknown ? RETRY_MS : CACHE_MS)) return hit.value;
  }
  const value = evaluateSenderAuth(await lookupSenderRecords(key));
  cache.set(key, { at: Date.now(), value });
  return value;
}

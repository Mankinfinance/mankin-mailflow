import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { probeDatabase, type DatabaseProbe } from "@/lib/db/state";
import { assistantModel } from "@/lib/assistant/run";
import { checkSenderAuth, type SenderAuth } from "@/lib/campaigns/sender-auth";
import { senderDomain } from "@/lib/mailflow/sending-config";
import { TEAM } from "@/lib/team";

/**
 * "Test connections": every outside service Mailflow depends on, called
 * for real rather than checked for a variable being present. A key that
 * is set but revoked, a secret that expired last week, a permission
 * added without admin consent: all of those pass a presence check and
 * fail the first send.
 *
 * Nothing here sends an email, spends more than a lookup, or returns a
 * secret. Each result says what was found and what to do about it.
 *
 * Dependencies come in through `deps` so the tests can run every branch
 * without a network.
 */

export type TestStatus = "pass" | "warn" | "fail" | "skip";

export interface ConnectionResult {
  key: string;
  label: string;
  status: TestStatus;
  detail: string;
  fix: string;
}

export interface ConnectionDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  probeDatabase: () => Promise<DatabaseProbe>;
  /** Resolves when the key can see the model; throws the SDK error otherwise. */
  retrieveModel: (apiKey: string, model: string) => Promise<unknown>;
  senderAuth: (domain: string) => Promise<SenderAuth>;
  mailboxes: Array<{ name: string; email: string }>;
  model: string;
}

const TIMEOUT_MS = 10_000;
const NEEDED_ROLES = ["Mail.Send", "Mail.Read"] as const;

const set = (v?: string) => Boolean(v && v.trim());
const result = (r: ConnectionResult) => r;

function withTimeout(signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(TIMEOUT_MS);
}

/* ---------- Database ---------- */

async function testDatabase(deps: ConnectionDeps): Promise<ConnectionResult> {
  const base = { key: "database", label: "Database (DATABASE_URL)" };
  if (!set(deps.env.DATABASE_URL)) {
    return result({ ...base, status: "fail", detail: "DATABASE_URL is not set, so nothing is kept between visits.", fix: "Set DATABASE_URL in Vercel to the Supabase connection string, then redeploy." });
  }
  if (deps.env.MOCK_DB === "true") {
    return result({ ...base, status: "fail", detail: "MOCK_DB is \"true\", which forces an in-memory database even though DATABASE_URL is set.", fix: "Delete MOCK_DB in Vercel and redeploy." });
  }
  const probe = await deps.probeDatabase();
  if (!probe.reachable) {
    return result({ ...base, status: "fail", detail: `Could not connect: ${probe.error ?? "unknown error"}`, fix: "Check DATABASE_URL in Vercel. Use Supabase's pooled connection string (port 6543)." });
  }
  if (probe.tablesMissing.length > 0) {
    return result({ ...base, status: "warn", detail: `Connected, but ${probe.tablesMissing.length} table${probe.tablesMissing.length === 1 ? " is" : "s are"} missing (${probe.tablesMissing.slice(0, 3).join(", ")}${probe.tablesMissing.length > 3 ? "…" : ""}).`, fix: "Press \"Set up the tables\" at the top of this page." });
  }
  return result({ ...base, status: "pass", detail: `Connected. All ${probe.tablesPresent.length} tables are there.`, fix: "" });
}

/* ---------- Microsoft Graph ---------- */

interface TokenJson {
  access_token?: string;
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

function rolesIn(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { roles?: unknown };
    return Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/** Azure's error codes for the mistakes people actually make. */
function explainTokenError(json: TokenJson): { detail: string; fix: string } {
  const codes = json.error_codes ?? [];
  const text = json.error_description?.split("\r\n")[0] ?? json.error ?? "unknown error";
  if (codes.includes(7000222)) {
    return { detail: "The client secret has expired.", fix: "Azure → App registrations → the app → Certificates & secrets → New client secret. Put the Value in MS_GRAPH_CLIENT_SECRET and redeploy." };
  }
  if (codes.includes(7000215)) {
    return { detail: "The client secret is wrong. Usually the Secret ID was copied instead of the Value.", fix: "Make a new client secret and copy the Value column, not Secret ID, into MS_GRAPH_CLIENT_SECRET." };
  }
  if (codes.includes(700016)) {
    return { detail: "No app with that client ID exists in this tenant.", fix: "Copy the Application (client) ID from the app's Overview page into MS_GRAPH_CLIENT_ID." };
  }
  if (codes.includes(90002) || codes.includes(900023)) {
    return { detail: "The tenant ID is not recognised.", fix: "Copy the Directory (tenant) ID from the app's Overview page into MS_GRAPH_TENANT_ID." };
  }
  return { detail: `Microsoft refused the sign-in: ${text}`, fix: "Check the three MS_GRAPH_* values in Vercel against the app registration." };
}

async function testGraph(deps: ConnectionDeps): Promise<ConnectionResult[]> {
  const base = { key: "graph", label: "Microsoft 365 sending (MS_GRAPH_*)" };
  const { MS_GRAPH_TENANT_ID: tenant, MS_GRAPH_CLIENT_ID: client, MS_GRAPH_CLIENT_SECRET: secret } = deps.env;
  const missing = [
    !set(tenant) && "MS_GRAPH_TENANT_ID",
    !set(client) && "MS_GRAPH_CLIENT_ID",
    !set(secret) && "MS_GRAPH_CLIENT_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    return [result({ ...base, status: "fail", detail: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set, so no email can be sent.`, fix: "Add them in Vercel from the app registration in Azure, then redeploy." })];
  }

  let token: string;
  try {
    const resp = await deps.fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: client!,
        client_secret: secret!,
        scope: "https://graph.microsoft.com/.default",
      }),
      signal: withTimeout(),
    });
    const json = (await resp.json().catch(() => ({}))) as TokenJson;
    if (!resp.ok || !json.access_token) {
      return [result({ ...base, status: "fail", ...explainTokenError(json) })];
    }
    token = json.access_token;
  } catch (err) {
    return [result({ ...base, status: "fail", detail: `Could not reach Microsoft: ${err instanceof Error ? err.message : String(err)}`, fix: "Try again in a minute. If it keeps failing, check Microsoft 365 service health." })];
  }

  const roles = rolesIn(token);
  const lacking = NEEDED_ROLES.filter((r) => !roles.includes(r));
  const out: ConnectionResult[] = [
    lacking.length === 0
      ? result({ ...base, status: "pass", detail: "Signed in to Microsoft. Mail.Send and Mail.Read are granted.", fix: "" })
      : result({
          ...base,
          status: "fail",
          detail: `Signed in, but ${lacking.join(" and ")} ${lacking.length === 1 ? "is" : "are"} not granted${lacking.includes("Mail.Send") ? ", so sending will be refused" : ", so bounces cannot be read"}.`,
          fix: "Azure → the app → API permissions → Add a permission → Microsoft Graph → Application permissions → tick Mail.Send and Mail.Read → Grant admin consent.",
        }),
  ];
  if (lacking.includes("Mail.Read")) return out;

  /* Reading each sender's inbox folder proves the app can reach that
     mailbox: an application access policy that leaves someone out, or a
     person with no Exchange licence, shows up here before a campaign
     goes out under their name. */
  const reach = await Promise.all(
    deps.mailboxes.map(async (m) => {
      try {
        const resp = await deps.fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m.email)}/mailFolders/inbox?$select=id`,
          { headers: { Authorization: `Bearer ${token}` }, signal: withTimeout() },
        );
        return { ...m, status: resp.status };
      } catch {
        return { ...m, status: 0 };
      }
    }),
  );
  const blocked = reach.filter((r) => r.status === 403);
  const absent = reach.filter((r) => r.status === 404);
  const errored = reach.filter((r) => r.status !== 200 && r.status !== 403 && r.status !== 404);
  const reachable = reach.filter((r) => r.status === 200);
  const mbBase = { key: "mailboxes", label: "Broker mailboxes" };
  if (blocked.length + absent.length + errored.length === 0) {
    out.push(result({ ...mbBase, status: "pass", detail: `All ${reachable.length} mailboxes can be sent from.`, fix: "" }));
  } else {
    const parts = [
      blocked.length > 0 && `blocked by an access policy: ${blocked.map((r) => r.name).join(", ")}`,
      absent.length > 0 && `no mailbox found: ${absent.map((r) => r.name).join(", ")}`,
      errored.length > 0 && `could not check: ${errored.map((r) => r.name).join(", ")}`,
    ].filter(Boolean);
    out.push(
      result({
        ...mbBase,
        status: reachable.length === 0 ? "fail" : "warn",
        detail: `${reachable.length} of ${reach.length} reachable. ${parts.join("; ")}.`,
        fix: absent.length > 0 && blocked.length === 0
          ? "Check the address in lib/team.ts and that the person has an Exchange Online licence. Anyone listed cannot send campaigns until fixed."
          : "Add these mailboxes to the app's access policy in Exchange Online (or remove the policy), or don't send campaigns from them.",
      }),
    );
  }
  return out;
}

/* ---------- Anthropic ---------- */

async function testAnthropic(deps: ConnectionDeps): Promise<ConnectionResult> {
  const base = { key: "anthropic", label: "Assistant (ANTHROPIC_API_KEY)" };
  const key = deps.env.ANTHROPIC_API_KEY;
  if (!set(key)) {
    return result({ ...base, status: "fail", detail: "ANTHROPIC_API_KEY is not set, so the assistant is off.", fix: "console.anthropic.com → API Keys → Create Key. Add it in Vercel and redeploy." });
  }
  if (deps.env.MOCK_CHAT === "true") {
    return result({ ...base, status: "warn", detail: "The key is set, but MOCK_CHAT is \"true\", which keeps the assistant off.", fix: "Delete MOCK_CHAT in Vercel and redeploy." });
  }
  try {
    await deps.retrieveModel(key!.trim(), deps.model);
    return result({ ...base, status: "pass", detail: `The key works and can use ${deps.model}.`, fix: "" });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) {
      return result({ ...base, status: "fail", detail: "Anthropic rejected the key.", fix: "Make a new key at console.anthropic.com → API Keys, replace ANTHROPIC_API_KEY in Vercel and redeploy." });
    }
    if (status === 404) {
      return result({ ...base, status: "fail", detail: `The key works, but the model "${deps.model}" is not available to it.`, fix: "Delete MAILFLOW_ASSISTANT_MODEL in Vercel to use the default, or set it to a model the account can use." });
    }
    if (status === 403) {
      return result({ ...base, status: "fail", detail: "The key is not allowed to use the API. Usually the account has no credit.", fix: "console.anthropic.com → Settings → Billing: add credit." });
    }
    return result({ ...base, status: "warn", detail: `Could not reach Anthropic: ${err instanceof Error ? err.message : String(err)}`, fix: "Try again in a minute." });
  }
}

/* ---------- Scheduled jobs, addresses, DNS ---------- */

function testCron(env: ConnectionDeps["env"]): ConnectionResult {
  const base = { key: "cron", label: "Scheduled jobs (CRON_SECRET)" };
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    return result({ ...base, status: "fail", detail: "CRON_SECRET is not set, so scheduled campaigns, automations, webhooks and bounce checks never run.", fix: "Generate a random 32+ character password, add it in Vercel as CRON_SECRET, and redeploy." });
  }
  if (secret.length < 24) {
    return result({ ...base, status: "warn", detail: `CRON_SECRET is set but only ${secret.length} characters.`, fix: "Replace it with a random password of 32 characters or more." });
  }
  return result({ ...base, status: "pass", detail: "Set. Vercel sends it with every scheduled run.", fix: "" });
}

function testSending(env: ConnectionDeps["env"]): ConnectionResult {
  const base = { key: "sending", label: "Live sending (MOCK_OUTLOOK_SEND)" };
  if (env.MOCK_OUTLOOK_SEND === "true") {
    return result({ ...base, status: "warn", detail: "MOCK_OUTLOOK_SEND is \"true\": emails are only pretended, nothing reaches anyone.", fix: "Delete MOCK_OUTLOOK_SEND in Vercel and redeploy when you're ready to send for real." });
  }
  return result({ ...base, status: "pass", detail: "Emails are sent for real.", fix: "" });
}

async function testAppUrl(deps: ConnectionDeps): Promise<ConnectionResult> {
  const base = { key: "app-url", label: "Address in email links (NEXT_PUBLIC_APP_URL)" };
  const raw = deps.env.NEXT_PUBLIC_APP_URL?.trim();
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    return result({ ...base, status: "fail", detail: "NEXT_PUBLIC_APP_URL is not set, so unsubscribe and tracking links in emails don't work.", fix: "Set it in Vercel to https://mankin-mailflow.vercel.app (or your own link domain) and redeploy." });
  }
  if (url.hostname.includes("mankin-followup")) {
    return result({ ...base, status: "fail", detail: `It points at ${url.host}, which is LoanFlow. Every unsubscribe link would go to the wrong app.`, fix: "Change it to https://mankin-mailflow.vercel.app and redeploy." });
  }
  if (url.protocol !== "https:") {
    return result({ ...base, status: "fail", detail: `It is ${url.origin}, not https.`, fix: "Use the https:// address." });
  }
  try {
    const resp = await deps.fetch(new URL("/api/health", url).toString(), { cache: "no-store", signal: withTimeout() });
    const json = (await resp.json().catch(() => null)) as { ok?: boolean } | null;
    if (!resp.ok || json?.ok !== true) {
      return result({
        ...base,
        status: "fail",
        detail: `${url.host} answered, but not as Mailflow (status ${resp.status}).`,
        fix: resp.status === 401 || resp.status === 403
          ? "Vercel's Deployment Protection may be on for production, which would block clients' unsubscribe links too. Vercel → Settings → Deployment Protection: protect previews only."
          : "Check the address is this project's, and that the domain is attached to mankin-mailflow in Vercel.",
      });
    }
  } catch (err) {
    return result({ ...base, status: "fail", detail: `${url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}.`, fix: "If this is a new domain, finish its DNS record in Vercel → Settings → Domains first, or set the address back to https://mankin-mailflow.vercel.app." });
  }
  return result({ ...base, status: "pass", detail: `${url.host} is live and answers as Mailflow.`, fix: "" });
}

function testAuthUrl(env: ConnectionDeps["env"]): ConnectionResult {
  const base = { key: "auth-url", label: "Sign-in address (AUTH_URL)" };
  const authUrl = env.AUTH_URL?.trim();
  if (!authUrl) {
    return result({ ...base, status: "warn", detail: "AUTH_URL is not set, so sign-in relies on Vercel's own address detection.", fix: "Set AUTH_URL in Vercel to the address people sign in at, e.g. https://mankin-mailflow.vercel.app." });
  }
  if (authUrl.endsWith("/")) {
    return result({ ...base, status: "warn", detail: "AUTH_URL ends with a slash, which can break the Microsoft sign-in redirect.", fix: "Remove the trailing slash." });
  }
  return result({ ...base, status: "pass", detail: `Sign-in returns to ${authUrl}.`, fix: "" });
}

async function testDomain(deps: ConnectionDeps): Promise<ConnectionResult> {
  const base = { key: "domain", label: "Sending domain (DNS)" };
  const auth = await deps.senderAuth(senderDomain(deps.mailboxes[0]?.email));
  const failing = auth.checks.filter((c) => c.status === "fail").map((c) => c.label);
  const warning = auth.checks.filter((c) => c.status === "warn").map((c) => c.label);
  if (failing.length > 0) {
    return result({ ...base, status: "fail", detail: `${auth.domain}: ${failing.join(", ")} missing.`, fix: "See the Sending domain card below for the exact records." });
  }
  if (warning.length > 0) {
    return result({ ...base, status: "warn", detail: `${auth.domain}: ${warning.join(", ")} worth fixing.`, fix: "See the Sending domain card below." });
  }
  return result({ ...base, status: "pass", detail: `${auth.domain} passes SPF, DKIM and DMARC.`, fix: "" });
}

/* ---------- All of it ---------- */

export async function runConnectionTests(deps: ConnectionDeps): Promise<ConnectionResult[]> {
  /* Each test catches its own failures; this guard is for the
     unexpected, so one broken check can never hide the rest. */
  const safe = async <T extends ConnectionResult | ConnectionResult[]>(key: string, label: string, run: () => Promise<T> | T) => {
    try {
      return await run();
    } catch (err) {
      return result({ key, label, status: "fail", detail: `The check itself failed: ${err instanceof Error ? err.message : String(err)}`, fix: "" });
    }
  };
  const [db, graph, anthropic, appUrl, domain] = await Promise.all([
    safe("database", "Database (DATABASE_URL)", () => testDatabase(deps)),
    safe("graph", "Microsoft 365 sending (MS_GRAPH_*)", () => testGraph(deps)),
    safe("anthropic", "Assistant (ANTHROPIC_API_KEY)", () => testAnthropic(deps)),
    safe("app-url", "Address in email links (NEXT_PUBLIC_APP_URL)", () => testAppUrl(deps)),
    safe("domain", "Sending domain (DNS)", () => testDomain(deps)),
  ]);
  /* "Sent for real" is only true if something can send. */
  const graphOk = [graph].flat().every((r) => r.key !== "graph" || r.status === "pass");
  let sending = testSending(deps.env);
  if (sending.status === "pass" && !graphOk) {
    sending = { ...sending, status: "skip", detail: "Not simulated, but nothing can send until Microsoft 365 is connected (above)." };
  }
  return [
    db,
    graph,
    sending,
    testCron(deps.env),
    anthropic,
    appUrl,
    testAuthUrl(deps.env),
    domain,
  ].flat();
}

/** The real dependencies, for the Settings page. */
export function liveConnectionDeps(): ConnectionDeps {
  return {
    env: process.env,
    fetch: (...args) => fetch(...args),
    probeDatabase,
    retrieveModel: (apiKey, model) => new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS }).models.retrieve(model),
    senderAuth: (domain) => checkSenderAuth(domain, { fresh: true }),
    mailboxes: TEAM.filter((m) => m.email).map((m) => ({ name: m.name, email: m.email })),
    model: assistantModel(),
  };
}

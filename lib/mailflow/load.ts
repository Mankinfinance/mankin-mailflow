/**
 * Loading a page's data so one failure doesn't take the whole page down.
 *
 * Without this, any one source throwing (a database column the deploy
 * expects but the database doesn't have yet, the database unreachable)
 * turned the screen into Next's bare "This page couldn't load" with an
 * error number nobody can act on, including the Settings page whose
 * "Set up the tables" button is the usual fix. Each source now falls
 * back to empty, and the page lists what didn't load, why, and what to
 * do, in words.
 */

export interface LoadFailure {
  /** What didn't load, as the person would name it ("Campaigns"). */
  source: string;
  /** What went wrong, in a sentence. */
  message: string;
  /** What to do about it. */
  fix: string;
}

const SETUP_FIX =
  "Open Settings and press Set up the tables, in the \"Where the data lives\" panel at the top.";
const CONNECTION_FIX = "Open Settings and press Test connections to see what's wrong.";

const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "57P01", // admin shutdown
  "57P03", // cannot connect now
  "53300", // too many connections
]);

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/** The error and everything it wraps, outermost first. */
function chain(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current: unknown = err;
  while (current && typeof current === "object" && out.length < 5) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

/** One line of an error's own words, with anything that looks like a
 *  connection string or a query's values taken out. */
function cleanMessage(raw: string): string {
  const firstLine = raw.split("\n")[0] ?? "";
  return firstLine
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[address]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function describeLoadError(err: unknown): { message: string; fix: string } {
  const links = chain(err);
  const codes = links.map((e) => (typeof e.code === "string" ? e.code : ""));
  if (codes.includes("42P01")) {
    return { message: "A table Mailflow needs isn't in the database yet.", fix: SETUP_FIX };
  }
  if (codes.includes("42703")) {
    return {
      message: "The database is missing a column this version of Mailflow uses.",
      fix: SETUP_FIX,
    };
  }
  if (codes.includes("28P01") || codes.includes("28000")) {
    return { message: "The database turned down Mailflow's password.", fix: CONNECTION_FIX };
  }
  if (codes.some((c) => UNREACHABLE.has(c))) {
    return { message: "The database couldn't be reached.", fix: CONNECTION_FIX };
  }
  /* Drizzle's own message is the query and its values; the database's
     reason is on the cause. Prefer the innermost message that isn't a
     query echo. */
  const messages = links
    .map((e) => (typeof e.message === "string" ? e.message : ""))
    .filter((m) => m && !/^Failed query:/i.test(m));
  const message = cleanMessage(messages[messages.length - 1] ?? "") || "Something went wrong.";
  return { message, fix: "Reload the page. If it keeps happening, send a screenshot of this." };
}

/** A loader for one page render: `load` never throws, and `failures`
 *  lists what fell back. */
export function createLoader() {
  const failures: LoadFailure[] = [];
  async function load<T>(source: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      console.error(`[mailflow] ${source} didn't load`, err);
      if (!failures.some((f) => f.source === source)) {
        failures.push({ source, ...describeLoadError(err) });
      }
      return fallback;
    }
  }
  return { load, failures };
}

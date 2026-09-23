/**
 * Pre-send content check.
 *
 * Authentication and headers get a message accepted; content decides
 * where it lands after that. These are the checks a filter actually
 * applies, expressed as things a broker can fix before sending rather
 * than a score out of ten.
 *
 * Everything here warns. Nothing blocks — a false positive that stops a
 * legitimate send is worse than a marginal subject line, and a broker
 * who has seen the warning is better placed than the checker to judge.
 * The one hard rule (unknown merge fields) lives in the editor, because
 * that one is unambiguously a mistake.
 */

export type CheckSeverity = "warn" | "note";

export interface ContentIssue {
  severity: CheckSeverity;
  /** What is wrong, in the broker's terms. */
  message: string;
  /** What to do about it. */
  fix: string;
}

/**
 * Phrases that filters weight heavily. Kept short and specific to the
 * financial-services traps — a long generic list produces noise, and
 * noise trains people to click past the panel.
 */
const RISKY_PHRASES = [
  "act now",
  "apply now",
  "best rate",
  "cash bonus",
  "click here",
  "congratulations",
  "credit card offer",
  "double your",
  "0% interest",
  "free quote",
  "guaranteed approval",
  "limited time",
  "lowest rate",
  "no obligation",
  "no credit check",
  "pre-approved",
  "risk free",
  "special promotion",
  "this is not spam",
  "urgent",
  "winner",
];

const SHORTENERS = [
  "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "buff.ly",
  "rebrand.ly", "cutt.ly", "is.gd",
];

export interface CheckInput {
  subject: string;
  /** The body as written, before rendering. */
  body: string;
}

export function checkContent(input: CheckInput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  const haystack = `${subject}\n${body}`.toLowerCase();

  /* ---- Subject ---- */

  if (!subject) {
    issues.push({
      severity: "warn",
      message: "There is no subject line.",
      fix: "Missing subjects are filtered almost everywhere.",
    });
  } else {
    if (subject.length > 70) {
      issues.push({
        severity: "note",
        message: `The subject is ${subject.length} characters.`,
        fix: "It will be cut off on a phone. Under about 45 reads in full.",
      });
    }
    const letters = subject.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 6 && letters === letters.toUpperCase()) {
      issues.push({
        severity: "warn",
        message: "The subject is in capitals.",
        fix: "Sentence case. Capitals are one of the strongest spam signals.",
      });
    }
    if (/[!?]{2,}/.test(subject) || (subject.match(/!/g) ?? []).length > 1) {
      issues.push({
        severity: "warn",
        message: "The subject has repeated exclamation or question marks.",
        fix: "One at most, and none reads better in this business.",
      });
    }
    if (/\$|\d+%\s*(off|discount)/i.test(subject)) {
      issues.push({
        severity: "note",
        message: "The subject leads with a figure or a percentage.",
        fix: "Filters weight currency and discount claims in subjects heavily.",
      });
    }
  }

  /* ---- Body ---- */

  if (!body) {
    issues.push({
      severity: "warn",
      message: "There is no body.",
      fix: "Write something before sending.",
    });
    return issues;
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 25) {
    issues.push({
      severity: "warn",
      message: `The body is only ${words} words.`,
      fix: "Very short bodies with a link read as bait. Say something first.",
    });
  }

  const links = [...body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(
    (m) => m[1],
  );
  const bareLinks = [...body.matchAll(/(?<!\()\bhttps?:\/\/[^\s)]+/g)].map(
    (m) => m[0],
  );
  const allLinks = [...links, ...bareLinks];

  if (allLinks.length > 4) {
    issues.push({
      severity: "warn",
      message: `There are ${allLinks.length} links.`,
      fix: "One or two. A wall of links is the most common filter trigger.",
    });
  }

  const shortened = allLinks.filter((url) =>
    SHORTENERS.some((s) => url.includes(s)),
  );
  if (shortened.length > 0) {
    issues.push({
      severity: "warn",
      message: "A shortened link is used.",
      fix: "Link to mankinfinance.com directly. Shorteners are heavily penalised.",
    });
  }

  const offDomain = allLinks.filter(
    (url) => !/mankinfinance\.com|tidycal\.com|\{\{/.test(url),
  );
  if (offDomain.length > 0) {
    issues.push({
      severity: "note",
      message: "A link points somewhere other than your own domains.",
      fix: "Mail whose links and sender disagree is trusted less.",
    });
  }

  /* A template's [placeholder] still in the email. Square brackets not
     followed by "(" — that would be a link — and not preceded by "!",
     an image. The library's templates use these for the parts only the
     broker knows ("[suburb]", "[held / moved]"); one reaching a client
     reads as a form letter nobody finished. */
  const placeholders = [
    ...`${subject}\n${body}`.matchAll(/(?<!!)\[([^\]\n]{1,60})\](?!\()/g),
  ].map((m) => `[${m[1]}]`);
  if (placeholders.length > 0) {
    issues.push({
      severity: "warn",
      message: `A placeholder is still in the email: ${placeholders.slice(0, 3).join(", ")}${
        placeholders.length > 3 ? `, and ${placeholders.length - 3} more` : ""
      }.`,
      fix: "Replace it with the real detail, or delete the line.",
    });
  }

  const found = RISKY_PHRASES.filter((phrase) => haystack.includes(phrase));
  if (found.length > 0) {
    issues.push({
      severity: found.length > 2 ? "warn" : "note",
      message: `Phrases filters weight: ${found.slice(0, 4).join(", ")}${
        found.length > 4 ? `, and ${found.length - 4} more` : ""
      }.`,
      fix: "Rephrase in plain language. Say what it is, not how good it is.",
    });
  }

  const bodyLetters = body.replace(/[^a-zA-Z]/g, "");
  const upper = body.replace(/[^A-Z]/g, "").length;
  if (bodyLetters.length > 100 && upper / bodyLetters.length > 0.3) {
    issues.push({
      severity: "warn",
      message: "Much of the body is in capitals.",
      fix: "Sentence case throughout.",
    });
  }

  return issues;
}

/** Nothing to fix, in a word. Drives the editor's summary line. */
export function contentVerdict(issues: ContentIssue[]): "clean" | "notes" | "warnings" {
  if (issues.some((i) => i.severity === "warn")) return "warnings";
  if (issues.length > 0) return "notes";
  return "clean";
}

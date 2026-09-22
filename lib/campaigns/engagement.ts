/**
 * What one contact has done with the mail we have sent them, across
 * every campaign — and the hour of day they act on it.
 *
 * Mailchimp answers the first half with a five-star contact rating and
 * the second with "send time optimisation", both of which are opaque by
 * design: a star appears next to a name and nobody can say what would
 * move it. Everything here states its rule in a sentence, because a
 * broker deciding whether to keep mailing someone has to be able to
 * justify it, and "the software said three stars" is not a reason.
 *
 * Pure module — event rows in, profile out.
 */

const AU_TZ = "Australia/Sydney";

/** Below this many sends a rate says more about the sample than the
 *  person: one open out of two is 50%, and means nothing. */
export const MIN_FOR_RATE = 4;

/** Below this, no band at all. Two ignored emails is not a verdict. */
export const MIN_TO_JUDGE = 3;

/** How many clicks of their own before we claim to know a contact's
 *  hour. Under three it is one afternoon, not a habit. */
export const MIN_CLICKS_FOR_OWN_HOUR = 3;

/** And below this the whole list's habit is guesswork too. */
export const MIN_CLICKS_FOR_LIST_HOUR = 12;

/** One email we sent this person, and what came back. */
export interface EngagementEvent {
  /** Only used to keep events distinct; never displayed. */
  campaignId: string;
  /** Null when the send never went out — those are ignored entirely. */
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
}

/**
 * Where a contact sits.
 *
 * Deliberately five plain words rather than a score. Each is defined by
 * a countable fact about the last few sends, stated in `describeBand`,
 * so the label and the reason for it are the same thing.
 */
export type EngagementBand =
  | "engaged"
  | "cooling"
  | "dormant"
  | "never-opened"
  | "too-new";

export interface EngagementProfile {
  email: string;
  /** Sends that actually went out. Failures and skips are not "ignored". */
  received: number;
  opened: number;
  clicked: number;
  /** Null below MIN_FOR_RATE — a withheld number beats a misleading one. */
  openRate: number | null;
  clickRate: number | null;
  lastReceivedAt: Date | null;
  lastOpenedAt: Date | null;
  lastClickedAt: Date | null;
  /** Consecutive most-recent sends with no open. The band is built on it. */
  unopenedStreak: number;
  band: EngagementBand;
}

/**
 * Build one contact's profile from their sends, in any order.
 *
 * Events without a `sentAt` are dropped rather than counted as ignored:
 * a campaign that failed on a bad mailbox, or skipped someone who was
 * already suppressed, is not evidence about the person.
 */
export function buildEngagementProfile(
  email: string,
  events: EngagementEvent[],
): EngagementProfile {
  const sent = events
    .filter((e): e is EngagementEvent & { sentAt: Date } => e.sentAt !== null)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  const opened = sent.filter((e) => e.openedAt !== null).length;
  const clicked = sent.filter((e) => e.clickedAt !== null).length;

  /* Walk back from the most recent send until one was opened. */
  let unopenedStreak = 0;
  for (const e of sent) {
    if (e.openedAt !== null) break;
    unopenedStreak++;
  }

  const readable = sent.length >= MIN_FOR_RATE;

  return {
    email,
    received: sent.length,
    opened,
    clicked,
    openRate: readable ? (opened / sent.length) * 100 : null,
    clickRate: readable ? (clicked / sent.length) * 100 : null,
    lastReceivedAt: sent[0]?.sentAt ?? null,
    lastOpenedAt: latest(sent.map((e) => e.openedAt)),
    lastClickedAt: latest(sent.map((e) => e.clickedAt)),
    unopenedStreak,
    band: bandFor(sent.length, opened, unopenedStreak),
  };
}

function bandFor(
  received: number,
  opened: number,
  unopenedStreak: number,
): EngagementBand {
  if (received < MIN_TO_JUDGE) return "too-new";
  if (opened === 0) return "never-opened";
  if (unopenedStreak <= 2) return "engaged";
  if (unopenedStreak <= 5) return "cooling";
  return "dormant";
}

/** The rule behind the label, in the words the UI shows. */
export function describeBand(profile: EngagementProfile): string {
  switch (profile.band) {
    case "too-new":
      return `Only ${profile.received} ${plural(profile.received, "email")} so far — not enough to read either way.`;
    case "never-opened":
      return `${profile.received} emails, none opened. Worth checking the address is right before assuming disinterest.`;
    case "engaged":
      return profile.unopenedStreak === 0
        ? "Opened the most recent email."
        : `Opened one of the last ${profile.unopenedStreak + 1}.`;
    case "cooling":
      return `Has opened before, but not the last ${profile.unopenedStreak}.`;
    case "dormant":
      return `Nothing opened in the last ${profile.unopenedStreak}. Mailing on is legal, but it is spending sender reputation on someone who has stopped reading.`;
  }
}

/* -------------------------------------------------------------------------- */
/* When to send                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The hour a contact acts, built from clicks rather than opens.
 *
 * This is the one place where following Mailchimp exactly would make
 * the feature worse. An open is a pixel load, and since Apple's Mail
 * Privacy Protection a large share of those are a proxy fetching the
 * image shortly after delivery, whatever the recipient is doing — so
 * open *timestamps* cluster around send time and would teach the model
 * that the best hour to send is the hour we happened to send. Gmail's
 * image cache does a milder version of the same thing.
 *
 * A click has no proxy behind it. It is rarer, which is why the
 * thresholds here are low and the answer is often "not enough to tell"
 * — which is the honest answer, and better than an hour derived from
 * our own sending schedule reflected back at us.
 */
export interface SendWindow {
  /** 0-23, Australia/Sydney. */
  hour: number;
  /** Whose habit this is: this contact's, or the whole list's. */
  basis: "own" | "list";
  /** Clicks the hour was drawn from, so the UI can show its working. */
  sampleSize: number;
}

/** Clicks per hour of day across everyone, for the fallback. */
export type SendTimeModel = { hour: number; clicks: number }[];

/** Build the list-wide picture. Null when there is too little to use. */
export function buildSendTimeModel(events: EngagementEvent[]): SendTimeModel | null {
  return buildSendTimeModelFromClicks(
    events.flatMap((e) => (e.clickedAt ? [e.clickedAt] : [])),
  );
}

/**
 * The same model from bare click timestamps.
 *
 * The campaign editor reads them straight out of one column rather than
 * assembling per-contact events it has no other use for.
 */
export function buildSendTimeModelFromClicks(
  clickedAt: Date[],
): SendTimeModel | null {
  if (clickedAt.length < MIN_CLICKS_FOR_LIST_HOUR) return null;
  return tally(clickedAt.map(hourInSydney));
}

/**
 * The best hour for one contact: their own if they have clicked enough,
 * otherwise the list's. Null when neither is known — in which case the
 * caller should send when it was going to anyway rather than invent one.
 */
export function bestSendHour(
  events: EngagementEvent[],
  listModel: SendTimeModel | null,
): SendWindow | null {
  const own = clickHours(events);
  if (own.length >= MIN_CLICKS_FOR_OWN_HOUR) {
    const top = tally(own)[0];
    return { hour: top.hour, basis: "own", sampleSize: own.length };
  }
  if (listModel && listModel.length > 0) {
    const top = listModel[0];
    const total = listModel.reduce((sum, h) => sum + h.clicks, 0);
    return { hour: top.hour, basis: "list", sampleSize: total };
  }
  return null;
}

/** "8am", "1pm" — the hour as a broker would say it. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** One line for the UI, including why it is or is not worth acting on. */
export function describeSendWindow(window: SendWindow | null): string {
  if (!window) {
    return "Not enough clicks yet to tell when this list acts. Send when it suits.";
  }
  const when = formatHour(window.hour);
  return window.basis === "own"
    ? `Clicks most often around ${when}, across ${window.sampleSize} clicks of their own.`
    : `No pattern for this contact yet. The list as a whole clicks most around ${when}.`;
}

/* -------------------------------------------------------------------------- */

function clickHours(events: EngagementEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.clickedAt) out.push(hourInSydney(e.clickedAt));
  }
  return out;
}

/**
 * Ties break toward the earlier hour. Arbitrary either way, but it has
 * to be deterministic or the same data would recommend a different hour
 * on every page load.
 */
function tally(hours: number[]): SendTimeModel {
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts.entries()]
    .map(([hour, clicks]) => ({ hour, clicks }))
    .sort((a, b) => b.clicks - a.clicks || a.hour - b.hour);
}

/** The firm, its clients and its sending schedule are all in one zone. */
function hourInSydney(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: AU_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(at),
  ) % 24;
}

function latest(dates: Array<Date | null>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (best === null || d > best)) best = d;
  }
  return best;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

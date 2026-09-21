import "server-only";
import { getMicrosoftAccessTokenInfo } from "./outlook-send";

/**
 * Refresh scope for the calendar path. Wider than the mail default — it
 * adds Calendars.ReadWrite. A refresh_token grant only succeeds if the
 * broker has already consented to every scope here, so before re-consent
 * this refresh fails with AADSTS65001 and we surface a "reconnect"
 * prompt. Crucially, this never touches the mail send path, which keeps
 * refreshing with its own mail-only scope.
 */
const CALENDAR_REFRESH_SCOPE =
  "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.ReadWrite offline_access";

/**
 * Live Microsoft Outlook calendar via Graph, using the signed-in
 * broker's delegated token (the same token the mail send path uses,
 * now carrying the Calendars.ReadWrite scope). Powers the CX Manager
 * calendar: it reads the broker's real Outlook events (GET
 * /me/calendarView) and books meetings on their calendar (POST
 * /me/events), so anything booked here shows up instantly in Outlook /
 * Teams and vice-versa.
 *
 * Meeting links:
 *  - "teams": Graph mints a real Teams join link natively
 *    (isOnlineMeeting + teamsForBusiness). This is the only provider we
 *    can auto-generate because the event lives on a Microsoft calendar.
 *  - "custom": the broker pastes their own link (Zoom, Google Meet,
 *    Webex). We can't mint those from Outlook — a native Google Meet
 *    link would need a separate Google Calendar connection.
 *  - "inPerson" / "phone": no link; a location / note instead.
 *
 * Token lifecycle + mock gating mirror outlook-send.ts:
 *  - Reuses getMicrosoftAccessTokenInfo() so refresh + error
 *    classification stay in one place.
 *  - When SKIP_AUTH !== "false" or MOCK_CALENDAR === "true" we return
 *    sample data / a mock booking so local dev and the pre-consent
 *    Vercel state keep rendering without a real Entra tenant.
 */

/** Windows time-zone id for Sydney. DST-aware (covers AEST + AEDT), so
 *  we hand Graph wall-clock times labelled with this and it resolves the
 *  correct UTC offset for the date. The Mankin team is Sydney-based. */
export const MANKIN_TZ = "AUS Eastern Standard Time";

export type MeetingType =
  | "teams"
  | "googlemeet"
  | "custom"
  | "inPerson"
  | "phone";

/** Meeting types where the broker pastes their own join link (Outlook can
 *  only mint Teams links itself, since the event lives on a Microsoft
 *  calendar). */
function isPastedLink(t: MeetingType): boolean {
  return t === "googlemeet" || t === "custom";
}

export interface CalendarEvent {
  id: string;
  subject: string;
  /** UTC ISO — the client renders it in the viewer's local zone. */
  startIso: string;
  endIso: string;
  isAllDay: boolean;
  isOnlineMeeting: boolean;
  /** Teams/other join URL when the event is online, else null. */
  joinUrl: string | null;
  /** Outlook Web deep link to the event. */
  webLink: string | null;
  location: string | null;
  organizer: string | null;
  /** free | tentative | busy | oof | workingElsewhere | unknown */
  showAs: string | null;
}

export type CalendarListResult =
  | { ok: true; events: CalendarEvent[]; mode: "live" | "mock" }
  | { ok: false; reason: string; message: string };

export interface BookMeetingInput {
  subject: string;
  /** Local wall-clock start "YYYY-MM-DDTHH:mm" (Sydney), from the UI. */
  startLocal: string;
  durationMins: number;
  attendeeEmail: string;
  attendeeName?: string;
  /** Optional agenda / note. Plain text; we wrap it as HTML. */
  note?: string;
  meetingType: MeetingType;
  /** custom → the pasted meeting link; inPerson → the address / room. */
  locationOrLink?: string;
}

export type BookMeetingResult =
  | { ok: true; event: CalendarEvent; mode: "live" | "mock" }
  | { ok: false; reason: string; message: string };

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  location?: { displayName?: string } | null;
  organizer?: { emailAddress?: { name?: string; address?: string } } | null;
  showAs?: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";

function mockGate(): boolean {
  return process.env.SKIP_AUTH !== "false" || process.env.MOCK_CALENDAR === "true";
}

/**
 * Map a token-resolution failure to a calendar result. When the broker
 * hasn't granted Calendars.ReadWrite yet, Azure rejects the token refresh
 * with AADSTS65001 ("has not consented") — that surfaces here as a
 * "refresh-failed" reason carrying the raw Azure text. Re-classify those
 * consent errors as "needs-consent" so the UI shows the Connect card and
 * a friendly message instead of a raw Azure blob. Other failures pass
 * through unchanged.
 */
function tokenFailure(
  reason: string,
  message: string,
): { ok: false; reason: string; message: string } {
  if (/AADSTS65001|not consented|consent required|\bconsent\b/i.test(message)) {
    return {
      ok: false,
      reason: "needs-consent",
      message:
        "Your Microsoft session doesn't have calendar access yet. Connect your calendar to grant it.",
    };
  }
  return { ok: false, reason, message };
}

/**
 * Normalise a Graph dateTime to a UTC ISO string. calendarView without a
 * Prefer:outlook.timezone header returns times already in UTC, but the
 * dateTime field carries 7 fractional digits and no "Z", which some
 * runtimes parse inconsistently. Strip the fraction and append Z.
 */
function toUtcIso(dt: GraphDateTime | undefined, fallback: string): string {
  if (!dt?.dateTime) return fallback;
  const base = dt.dateTime.split(".")[0];
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(base) ? base : `${base}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function normalizeEvent(ev: GraphEvent): CalendarEvent {
  const startIso = toUtcIso(ev.start, new Date().toISOString());
  return {
    id: ev.id,
    subject: ev.subject?.trim() || "(no subject)",
    startIso,
    endIso: toUtcIso(ev.end, startIso),
    isAllDay: Boolean(ev.isAllDay),
    isOnlineMeeting: Boolean(ev.isOnlineMeeting),
    joinUrl: ev.onlineMeeting?.joinUrl ?? null,
    webLink: ev.webLink ?? null,
    location: ev.location?.displayName?.trim() || null,
    organizer: ev.organizer?.emailAddress?.name?.trim() || null,
    showAs: ev.showAs ?? null,
  };
}

/** Add minutes to a tz-naive "YYYY-MM-DDTHH:mm" wall-clock string. */
function addMinutesToLocal(local: string, mins: number): string {
  const [datePart, timePart] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart ?? "00:00").split(":").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, 0) + mins * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`
  );
}

/** Build a handful of sample events inside the window for dev / pre-consent. */
function mockEvents(startIso: string, endIso: string): CalendarEvent[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const out: CalendarEvent[] = [];
  const cursor = new Date(start);
  const samples = [
    { hour: 9, mins: 30, subject: "Team huddle", online: true },
    { hour: 11, mins: 60, subject: "Refinance review — Nguyen", online: true },
    { hour: 14, mins: 45, subject: "Settlement follow-up call", online: false },
  ];
  let day = 0;
  while (cursor < end && day < 7) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const pick = samples[day % samples.length];
      const s = new Date(cursor);
      s.setUTCHours(pick.hour, 0, 0, 0);
      const e = new Date(s.getTime() + pick.mins * 60_000);
      out.push({
        id: `mock-${day}`,
        subject: pick.subject,
        startIso: s.toISOString(),
        endIso: e.toISOString(),
        isAllDay: false,
        isOnlineMeeting: pick.online,
        joinUrl: pick.online ? "https://teams.microsoft.com/l/meetup-join/mock" : null,
        webLink: null,
        location: pick.online ? "Microsoft Teams" : "Phone",
        organizer: "You",
        showAs: "busy",
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    day += 1;
  }
  return out;
}

/**
 * List the broker's Outlook events between two UTC ISO instants
 * (typically a week window). Never throws — returns a discriminated
 * result so the calendar UI can show a "reconnect your calendar" banner
 * rather than crashing the page when consent is missing.
 */
export async function listCalendarEvents(args: {
  startIso: string;
  endIso: string;
}): Promise<CalendarListResult> {
  if (mockGate()) {
    return { ok: true, mode: "mock", events: mockEvents(args.startIso, args.endIso) };
  }

  const tokenInfo = await getMicrosoftAccessTokenInfo(CALENDAR_REFRESH_SCOPE);
  if (!tokenInfo.ok) {
    return tokenFailure(tokenInfo.reason, tokenInfo.message);
  }

  const params = new URLSearchParams({
    startDateTime: args.startIso,
    endDateTime: args.endIso,
    $select:
      "id,subject,start,end,isAllDay,isOnlineMeeting,onlineMeeting,webLink,location,organizer,showAs",
    $orderby: "start/dateTime",
    $top: "200",
  });

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH}/me/calendarView?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tokenInfo.accessToken}` },
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: `Network error reaching Microsoft Graph: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    // 403 with an error code about scope/consent is the "re-consent" case.
    const needsConsent =
      resp.status === 403 || /consent|scope|Authorization_Request/i.test(text);
    return {
      ok: false,
      reason: needsConsent ? "needs-consent" : "graph-error",
      message: needsConsent
        ? "Your Microsoft session doesn't have calendar access yet. Sign out and back in to grant Calendars.ReadWrite."
        : `Graph /me/calendarView returned ${resp.status}: ${text.slice(0, 300)}`,
    };
  }

  const data = (await resp.json().catch(() => ({}))) as { value?: GraphEvent[] };
  const events = (data.value ?? []).map(normalizeEvent);
  return { ok: true, mode: "live", events };
}

/**
 * Book a meeting on the broker's Outlook calendar. Creating an event
 * with attendees makes Graph send the invite automatically, so the
 * customer receives it in their inbox. Returns the created event
 * (including a Teams join link when meetingType is "teams").
 */
export async function createCalendarEvent(
  input: BookMeetingInput,
): Promise<BookMeetingResult> {
  const startDateTime = `${input.startLocal}:00`;
  const endDateTime = addMinutesToLocal(input.startLocal, input.durationMins);

  if (mockGate()) {
    const startIso = new Date(`${input.startLocal}:00Z`).toISOString();
    const endIso = new Date(
      new Date(`${input.startLocal}:00Z`).getTime() + input.durationMins * 60_000,
    ).toISOString();
    return {
      ok: true,
      mode: "mock",
      event: {
        id: "mock-booked",
        subject: input.subject,
        startIso,
        endIso,
        isAllDay: false,
        isOnlineMeeting: input.meetingType === "teams",
        joinUrl:
          input.meetingType === "teams"
            ? "https://teams.microsoft.com/l/meetup-join/mock-booking"
            : isPastedLink(input.meetingType)
              ? input.locationOrLink ?? null
              : null,
        webLink: null,
        location:
          input.meetingType === "inPerson"
            ? input.locationOrLink ?? null
            : input.meetingType === "teams"
              ? "Microsoft Teams"
              : input.meetingType === "googlemeet"
                ? "Google Meet"
                : null,
        organizer: "You",
        showAs: "busy",
      },
    };
  }

  const tokenInfo = await getMicrosoftAccessTokenInfo(CALENDAR_REFRESH_SCOPE);
  if (!tokenInfo.ok) {
    return tokenFailure(tokenInfo.reason, tokenInfo.message);
  }

  const noteHtml = input.note
    ? `<p>${escapeHtml(input.note).replace(/\n/g, "<br>")}</p>`
    : "";
  let bodyHtml = noteHtml;

  const payload: Record<string, unknown> = {
    subject: input.subject,
    start: { dateTime: startDateTime, timeZone: MANKIN_TZ },
    end: { dateTime: endDateTime, timeZone: MANKIN_TZ },
    attendees: input.attendeeEmail
      ? [
          {
            emailAddress: {
              address: input.attendeeEmail,
              name: input.attendeeName || input.attendeeEmail,
            },
            type: "required",
          },
        ]
      : [],
  };

  if (input.meetingType === "teams") {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = "teamsForBusiness";
  } else if (isPastedLink(input.meetingType) && input.locationOrLink) {
    payload.location = {
      displayName:
        input.meetingType === "googlemeet" ? "Google Meet" : "Online meeting",
    };
    bodyHtml += `<p>Join here: <a href="${escapeHtml(input.locationOrLink)}">${escapeHtml(
      input.locationOrLink,
    )}</a></p>`;
  } else if (input.meetingType === "inPerson" && input.locationOrLink) {
    payload.location = { displayName: input.locationOrLink };
  } else if (input.meetingType === "phone") {
    bodyHtml += `<p>Phone call — we'll ring you at the number on file.</p>`;
  }

  payload.body = { contentType: "HTML", content: bodyHtml };

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH}/me/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenInfo.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: `Network error reaching Microsoft Graph: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const needsConsent =
      resp.status === 403 || /consent|scope|Authorization_Request/i.test(text);
    return {
      ok: false,
      reason: needsConsent ? "needs-consent" : "graph-error",
      message: needsConsent
        ? "Your Microsoft session doesn't have calendar access yet. Sign out and back in to grant Calendars.ReadWrite."
        : `Graph /me/events returned ${resp.status}: ${text.slice(0, 300)}`,
    };
  }

  const ev = (await resp.json().catch(() => ({}))) as GraphEvent;
  const event = normalizeEvent(ev);
  // For a pasted link (Google Meet / other) the join URL lives in the
  // pasted value, not in Graph's onlineMeeting field.
  if (isPastedLink(input.meetingType) && input.locationOrLink) {
    event.joinUrl = input.locationOrLink;
  }
  return { ok: true, mode: "live", event };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

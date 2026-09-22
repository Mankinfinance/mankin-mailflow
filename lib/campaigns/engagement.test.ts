import { describe, it, expect } from "vitest";
import {
  MIN_CLICKS_FOR_LIST_HOUR,
  MIN_FOR_RATE,
  MIN_TO_JUDGE,
  bestSendHour,
  buildEngagementProfile,
  buildSendTimeModel,
  describeBand,
  describeSendWindow,
  formatHour,
  type EngagementEvent,
} from "./engagement";

/** A send on a given day, optionally opened and/or clicked. */
function send(
  day: number,
  opts: { opened?: boolean; clicked?: boolean; sent?: boolean } = {},
): EngagementEvent {
  const at = new Date(Date.UTC(2026, 0, day, 2, 0, 0));
  return {
    campaignId: `c${day}`,
    sentAt: opts.sent === false ? null : at,
    openedAt: opts.opened ? new Date(at.getTime() + 3600_000) : null,
    clickedAt: opts.clicked ? new Date(at.getTime() + 7200_000) : null,
  };
}

/** A click at a given Sydney hour, so the hour maths is the thing tested. */
function clickAtSydneyHour(hour: number, day = 5): EngagementEvent {
  /* January is AEDT, UTC+11. */
  const utcHour = (hour - 11 + 24) % 24;
  const at = new Date(Date.UTC(2026, 0, day, utcHour, 30, 0));
  return { campaignId: `h${day}-${hour}`, sentAt: at, openedAt: at, clickedAt: at };
}

describe("buildEngagementProfile", () => {
  it("counts only sends that went out", () => {
    // A send that failed on a bad mailbox is not evidence the person
    // ignored us.
    const p = buildEngagementProfile("a@b.com", [
      send(1, { opened: true }),
      send(2),
      send(3, { sent: false }),
    ]);
    expect(p.received).toBe(2);
    expect(p.opened).toBe(1);
  });

  it("withholds a rate below the readable floor", () => {
    const p = buildEngagementProfile(
      "a@b.com",
      Array.from({ length: MIN_FOR_RATE - 1 }, (_, i) => send(i + 1, { opened: i === 0 })),
    );
    expect(p.openRate).toBeNull();
    expect(p.clickRate).toBeNull();
    expect(p.opened).toBe(1);
  });

  it("gives a rate at the floor", () => {
    const p = buildEngagementProfile(
      "a@b.com",
      Array.from({ length: MIN_FOR_RATE }, (_, i) => send(i + 1, { opened: i < 2 })),
    );
    expect(p.openRate).toBeCloseTo(50);
  });

  it("counts the unopened streak back from the most recent send", () => {
    const p = buildEngagementProfile("a@b.com", [
      send(1, { opened: true }),
      send(2, { opened: true }),
      send(3),
      send(4),
    ]);
    expect(p.unopenedStreak).toBe(2);
  });

  it("does not depend on the order events arrive in", () => {
    const events = [send(4), send(1, { opened: true }), send(3), send(2, { opened: true })];
    expect(buildEngagementProfile("a@b.com", events).unopenedStreak).toBe(2);
  });

  it("reports the most recent open and click, not the first", () => {
    const p = buildEngagementProfile("a@b.com", [
      send(1, { opened: true, clicked: true }),
      send(9, { opened: true }),
    ]);
    expect(p.lastOpenedAt?.getUTCDate()).toBe(9);
    expect(p.lastClickedAt?.getUTCDate()).toBe(1);
  });

  it("copes with a contact who has never been sent anything", () => {
    const p = buildEngagementProfile("a@b.com", []);
    expect(p.received).toBe(0);
    expect(p.band).toBe("too-new");
    expect(p.lastReceivedAt).toBeNull();
  });
});

describe("the band", () => {
  it("withholds a verdict on too few sends", () => {
    const p = buildEngagementProfile(
      "a@b.com",
      Array.from({ length: MIN_TO_JUDGE - 1 }, (_, i) => send(i + 1)),
    );
    expect(p.band).toBe("too-new");
  });

  it("separates never-opened from gone quiet", () => {
    // The two call for different actions: one is probably a wrong
    // address, the other is a person who stopped reading.
    const never = buildEngagementProfile("a@b.com", [send(1), send(2), send(3)]);
    expect(never.band).toBe("never-opened");

    const quiet = buildEngagementProfile("a@b.com", [
      send(1, { opened: true }),
      ...Array.from({ length: 8 }, (_, i) => send(i + 2)),
    ]);
    expect(quiet.band).toBe("dormant");
  });

  it("calls a recent opener engaged", () => {
    const p = buildEngagementProfile("a@b.com", [
      send(1),
      send(2),
      send(3, { opened: true }),
    ]);
    expect(p.band).toBe("engaged");
  });

  it("calls three to five ignored cooling, not yet dormant", () => {
    const p = buildEngagementProfile("a@b.com", [
      send(1, { opened: true }),
      send(2),
      send(3),
      send(4),
    ]);
    expect(p.unopenedStreak).toBe(3);
    expect(p.band).toBe("cooling");
  });

  it("explains itself in the words shown on screen", () => {
    const p = buildEngagementProfile("a@b.com", [
      send(1, { opened: true }),
      ...Array.from({ length: 8 }, (_, i) => send(i + 2)),
    ]);
    expect(describeBand(p)).toMatch(/8/);
    expect(describeBand(p)).toMatch(/sender reputation/);
  });
});

describe("the send window", () => {
  it("reads the hour in Sydney terms, not UTC", () => {
    // 9am Sydney in January is 22:00 the previous day in UTC. Reading
    // the raw hour would recommend sending at ten at night.
    const model = buildSendTimeModel(
      Array.from({ length: MIN_CLICKS_FOR_LIST_HOUR }, (_, i) =>
        clickAtSydneyHour(9, i + 1),
      ),
    );
    expect(model?.[0].hour).toBe(9);
  });

  it("prefers a contact's own pattern over the list's", () => {
    const list = buildSendTimeModel(
      Array.from({ length: MIN_CLICKS_FOR_LIST_HOUR }, (_, i) =>
        clickAtSydneyHour(20, i + 1),
      ),
    );
    const own = [1, 2, 3].map((d) => clickAtSydneyHour(8, d));
    const w = bestSendHour(own, list);
    expect(w).toEqual({ hour: 8, basis: "own", sampleSize: 3 });
  });

  it("falls back to the list when a contact has clicked once or twice", () => {
    const list = buildSendTimeModel(
      Array.from({ length: MIN_CLICKS_FOR_LIST_HOUR }, (_, i) =>
        clickAtSydneyHour(20, i + 1),
      ),
    );
    const w = bestSendHour([clickAtSydneyHour(8)], list);
    expect(w?.basis).toBe("list");
    expect(w?.hour).toBe(20);
  });

  it("says nothing rather than guessing when neither is known", () => {
    expect(bestSendHour([clickAtSydneyHour(8)], null)).toBeNull();
    expect(describeSendWindow(null)).toMatch(/Send when it suits/);
  });

  it("will not build a list model on a handful of clicks", () => {
    const thin = Array.from({ length: MIN_CLICKS_FOR_LIST_HOUR - 1 }, (_, i) =>
      clickAtSydneyHour(9, i + 1),
    );
    expect(buildSendTimeModel(thin)).toBeNull();
  });

  it("ignores opens entirely", () => {
    // Apple's Mail Privacy Protection fetches the pixel shortly after
    // delivery whatever the recipient is doing, so open times cluster
    // around our own send hour. A model built on them would recommend
    // sending whenever we already send.
    const opensOnly: EngagementEvent[] = Array.from(
      { length: 40 },
      (_, i) => ({
        campaignId: `o${i}`,
        sentAt: new Date(Date.UTC(2026, 0, 1, 2, 0, 0)),
        openedAt: new Date(Date.UTC(2026, 0, 1, 2, 1, 0)),
        clickedAt: null,
      }),
    );
    expect(buildSendTimeModel(opensOnly)).toBeNull();
    expect(bestSendHour(opensOnly, null)).toBeNull();
  });

  it("breaks a tie the same way every time", () => {
    // Otherwise the same data recommends a different hour on each load.
    const even = [
      ...Array.from({ length: 6 }, (_, i) => clickAtSydneyHour(14, i + 1)),
      ...Array.from({ length: 6 }, (_, i) => clickAtSydneyHour(9, i + 10)),
    ];
    expect(buildSendTimeModel(even)?.[0].hour).toBe(9);
  });
});

describe("formatHour", () => {
  it("says the hour the way a person would", () => {
    expect(formatHour(0)).toBe("12am");
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(20)).toBe("8pm");
  });
});

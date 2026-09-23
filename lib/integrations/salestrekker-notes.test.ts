import { describe, it, expect, beforeEach, vi } from "vitest";

const addNote = vi.fn();

vi.mock("@/lib/clients/salestrekker", () => ({
  getSalestrekkerClient: () => ({ addNote }),
}));

const { noteFor, isNotedEvent, noteOnSalestrekker } = await import(
  "./salestrekker-notes"
);
const { repos } = await import("@/lib/db/repos");
import type { AudienceSource } from "@/lib/campaigns/types";

beforeEach(async () => {
  addNote.mockReset();
  addNote.mockResolvedValue(undefined);
  for (const c of await repos().campaign.list()) {
    await repos().campaign.remove(c.id);
  }
});

/**
 * A campaign with one recipient sourced from the given place.
 *
 * Typed as AudienceSource. These fixtures were once plain strings
 * carrying "deal", which matched the equally wrong code and let a
 * never-fires bug pass every test.
 */
async function campaignWith(sourceKind: AudienceSource, sourceId: string) {
  const campaign = await repos().campaign.create({
    name: "Rate review",
    subject: "Worth a look",
    body: "Hi",
    status: "sent",
    audience: {},
    fromBrokerId: "mm",
    createdBy: "mm",
  });
  await repos().campaign.setRecipients(campaign.id, [
    {
      campaignId: campaign.id,
      email: "sarah@example.com",
      name: "Sarah Chen",
      firstName: "Sarah",
      sourceKind,
      sourceId,
    },
  ]);
  return campaign;
}

describe("which events earn a note", () => {
  it("notes the four a broker would act on", () => {
    expect(isNotedEvent("contact.clicked")).toBe(true);
    expect(isNotedEvent("contact.unsubscribed")).toBe(true);
    expect(isNotedEvent("contact.bounced")).toBe(true);
    expect(isNotedEvent("survey.responded")).toBe(true);
  });

  it("leaves form.submitted alone", () => {
    // The form already creates the deal through the same client. A
    // note here would annotate a deal that exists because of it.
    expect(isNotedEvent("form.submitted")).toBe(false);
  });

  it("leaves campaign-level events alone", () => {
    // These are about a send, not about a person, so there is no file
    // they belong on.
    expect(isNotedEvent("campaign.sent")).toBe(false);
    expect(isNotedEvent("campaign.failed")).toBe(false);
  });
});

describe("what the note says", () => {
  it("names the campaign and the link that was clicked", () => {
    expect(
      noteFor("contact.clicked", {
        campaignName: "Rate review",
        url: "https://tidycal.com/book",
      }),
    ).toBe('Clicked a link in "Rate review": https://tidycal.com/book');
  });

  it("copes with a click that carries no link", () => {
    expect(noteFor("contact.clicked", { campaignName: "Rate review" })).toBe(
      'Clicked a link in "Rate review".',
    );
  });

  it("says an unsubscribe does not affect loan correspondence", () => {
    // The thing a broker needs to know before worrying about it.
    const note = noteFor("contact.unsubscribed", {});
    expect(note).toContain("Unsubscribed from marketing email");
    expect(note).toContain("Loan correspondence is unaffected");
  });

  it("turns a bounce into an action", () => {
    const note = noteFor("contact.bounced", { reason: "mailbox not found" });
    expect(note).toContain("mailbox not found");
    expect(note).toContain("confirming it next time you speak");
  });

  it("carries a survey score and comment", () => {
    expect(
      noteFor("survey.responded", { score: 9, comment: "  Very helpful  " }),
    ).toBe('Answered a survey — scored 9 out of 10. They said: "Very helpful"');
  });

  it("handles a survey with no score", () => {
    expect(noteFor("survey.responded", {})).toBe("Answered a survey.");
  });

  it("returns nothing for an event it does not narrate", () => {
    expect(noteFor("campaign.sent", {})).toBeNull();
  });
});

describe("finding the file to write on", () => {
  it("writes to the deal a recipient came from", async () => {
    const campaign = await campaignWith("deals", "deal-123");

    const result = await noteOnSalestrekker("contact.clicked", {
      campaignId: campaign.id,
      email: "sarah@example.com",
      campaignName: "Rate review",
      url: "https://tidycal.com/book",
    });

    expect(result.noted).toBe(true);
    expect(addNote).toHaveBeenCalledWith(
      "deal-123",
      'Clicked a link in "Rate review": https://tidycal.com/book',
    );
  });

  it("writes nothing for a contact from the settled back-book", async () => {
    // No open deal to annotate, and inventing one would be worse than
    // no note at all.
    const campaign = await campaignWith("settlements", "s-991");

    const result = await noteOnSalestrekker("contact.clicked", {
      campaignId: campaign.id,
      email: "sarah@example.com",
    });

    expect(result).toEqual({ noted: false, reason: "no-deal" });
    expect(addNote).not.toHaveBeenCalled();
  });

  it("prefers an explicit deal id over a lookup", async () => {
    const result = await noteOnSalestrekker("contact.unsubscribed", {
      dealId: "deal-explicit",
      email: "sarah@example.com",
    });
    expect(result.noted).toBe(true);
    expect(addNote.mock.calls[0][0]).toBe("deal-explicit");
  });

  it("swallows a CRM failure rather than losing the event", async () => {
    // The unsubscribe has already happened. Throwing here would roll
    // back something that genuinely occurred.
    addNote.mockRejectedValue(new Error("Salestrekker 503"));

    const result = await noteOnSalestrekker("contact.unsubscribed", {
      dealId: "deal-123",
    });

    expect(result).toEqual({ noted: false, reason: "failed" });
  });

  it("ignores an event it does not note", async () => {
    const result = await noteOnSalestrekker("campaign.sent", {
      dealId: "deal-123",
    });
    expect(result).toEqual({ noted: false, reason: "not-noted-event" });
    expect(addNote).not.toHaveBeenCalled();
  });
});

describe("payload keys match what the events actually send", () => {
  // These caught two real mismatches: the survey event carries `nps`
  // rather than `score`, and the bounce event carried no campaign at
  // all, so no bounce could ever find a file to be written on.
  it("reads the survey score from nps", () => {
    expect(noteFor("survey.responded", { nps: 9 })).toContain("scored 9");
  });

  it("still reads a score key if one is ever sent", () => {
    expect(noteFor("survey.responded", { score: 4 })).toContain("scored 4");
  });

  it("finds the file from a bounce's campaign", async () => {
    const campaign = await campaignWith("deals", "deal-456");
    const result = await noteOnSalestrekker("contact.bounced", {
      email: "sarah@example.com",
      campaignId: campaign.id,
      reason: "550 5.1.1 mailbox unavailable",
    });
    expect(result.noted).toBe(true);
    expect(addNote.mock.calls[0][1]).toContain("550 5.1.1 mailbox unavailable");
  });
});

describe("against the real audience resolver", () => {
  /* The test that would have caught the "deal" / "deals" bug. Every
     other fixture in this file is hand-written, and a hand-written
     fixture agrees with whatever the code under test believes. This
     one takes its source kind from resolveAudience itself — the code
     that writes campaign recipients in production. */
  it("notes a pipeline contact exactly as the resolver produces them", async () => {
    const { resolveAudience } = await import("@/lib/campaigns/audience");
    const { defaultAudienceFilter } = await import("@/lib/campaigns/types");

    const { members } = resolveAudience({
      filter: {
        ...defaultAudienceFilter(),
        sources: ["deals"],
        loanStatus: ["active"],
      },
      settlements: [],
      deals: [
        {
          id: "D-77",
          name: "Tom Reilly",
          email: "tom@example.com",
          brokerId: "mm",
          stageId: "lodged",
          lender: "Westpac",
          loanAmount: 500000,
          daysSinceContact: 40,
          nurturedAt: null,
          excludeFromDailyUpdates: false,
          applicants: [],
        } as never,
      ],
      today: new Date("2026-09-23T00:00:00Z"),
    });
    expect(members).toHaveLength(1);

    const campaign = await repos().campaign.create({
      name: "Pipeline nudge",
      subject: "Checking in",
      body: "Hi",
      status: "sent",
      audience: {},
      fromBrokerId: "mm",
      createdBy: "mm",
    });
    const m = members[0];
    await repos().campaign.setRecipients(campaign.id, [
      {
        campaignId: campaign.id,
        email: m.email,
        name: m.name,
        firstName: m.firstName,
        sourceKind: m.sourceKind,
        sourceId: m.sourceId,
      },
    ]);

    const result = await noteOnSalestrekker("contact.clicked", {
      campaignId: campaign.id,
      email: m.email,
      campaignName: "Pipeline nudge",
    });

    expect(result).toEqual({ noted: true });
    expect(addNote.mock.calls[0][0]).toBe("D-77");
  });
});

describe("automation notes", () => {
  it("puts the milestone on the file in the canvas's own words", () => {
    expect(
      noteFor("automation.entered", {
        automationName: "Annual review",
        triggerDescription: "A loan passes its 12-month settlement anniversary",
      }),
    ).toBe(
      'Started the "Annual review" sequence: a loan passes its 12-month settlement anniversary.',
    );
  });

  it("writes the milestone onto the deal the run came from", async () => {
    const result = await noteOnSalestrekker("automation.entered", {
      automationName: "Pre-approval going cold",
      triggerDescription: "A deal has been at Pre-Approval for 60 days",
      dealId: "D-12",
    });
    expect(result.noted).toBe(true);
    expect(addNote).toHaveBeenCalledWith(
      "D-12",
      'Started the "Pre-approval going cold" sequence: a deal has been at Pre-Approval for 60 days.',
    );
  });

  it("closes with the exit step's note, which says what the ending means", () => {
    expect(
      noteFor("automation.completed", {
        automationName: "Annual review",
        outcome:
          "Opened, nothing further. The broker picks it up from the pipeline instead.",
      }),
    ).toBe(
      'Finished the "Annual review" sequence. Opened, nothing further. The broker picks it up from the pipeline instead.',
    );
  });

  it("still closes cleanly without one", () => {
    expect(
      noteFor("automation.completed", { automationName: "Annual review" }),
    ).toBe('Finished the "Annual review" sequence.');
  });

  it("names the sequence when a click came from one", () => {
    expect(
      noteFor("contact.clicked", {
        automationName: "Annual review",
        url: "https://tidycal.com/book",
      }),
    ).toBe('Clicked a link in "Annual review": https://tidycal.com/book');
  });

  it("does not note an exit or a detractor, which would say things twice", () => {
    // An unsubscribe is noted by contact.unsubscribed; a detractor's
    // score by survey.responded.
    expect(isNotedEvent("automation.exited")).toBe(false);
    expect(isNotedEvent("survey.detractor")).toBe(false);
  });
});

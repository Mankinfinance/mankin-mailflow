import { describe, it, expect, beforeEach, vi } from "vitest";

const addNote = vi.fn();

vi.mock("@/lib/clients/salestrekker", () => ({
  getSalestrekkerClient: () => ({ addNote }),
}));

const { noteFor, isNotedEvent, noteOnSalestrekker } = await import(
  "./salestrekker-notes"
);
const { repos } = await import("@/lib/db/repos");

beforeEach(async () => {
  addNote.mockReset();
  addNote.mockResolvedValue(undefined);
  for (const c of await repos().campaign.list()) {
    await repos().campaign.remove(c.id);
  }
});

/** A campaign with one recipient sourced from the given place. */
async function campaignWith(sourceKind: string, sourceId: string) {
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
    const campaign = await campaignWith("deal", "deal-123");

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
    const campaign = await campaignWith("deal", "deal-456");
    const result = await noteOnSalestrekker("contact.bounced", {
      email: "sarah@example.com",
      campaignId: campaign.id,
      reason: "550 5.1.1 mailbox unavailable",
    });
    expect(result.noted).toBe(true);
    expect(addNote.mock.calls[0][1]).toContain("550 5.1.1 mailbox unavailable");
  });
});

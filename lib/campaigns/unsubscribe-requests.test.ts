import { describe, it, expect } from "vitest";
import {
  firstLine,
  isUnsubscribeMailboxRequest,
  isUnsubscribeReply,
  isUnsubscribeWording,
  stripReplyPrefixes,
} from "./unsubscribe-requests";

const reply = (subject: string, body: string, from = "sarah@example.com") => ({ from, subject, body });

describe("isUnsubscribeWording", () => {
  it.each([
    "Unsubscribe",
    "unsubscribe me",
    "UNSUBSCRIBE!",
    "Please unsubscribe me",
    "Stop",
    "STOP.",
    "Opt out",
    "opt-out please",
    "Remove me",
    "Please remove me from your mailing list",
    "Take me off your list please",
    "Unsubscribe me from these emails, thanks",
    "Hi, unsubscribe",
  ])("counts %j", (text) => {
    expect(isUnsubscribeWording(text)).toBe(true);
  });

  it.each([
    "Please don't stop sending these",
    "Can you remove the second applicant from the loan?",
    "Stop by the office on Tuesday?",
    "Take a look at the attached payslip",
    "How do I unsubscribe my husband but keep me on?",
    "Thanks for the update, see you then",
    "",
  ])("leaves %j for a person", (text) => {
    expect(isUnsubscribeWording(text)).toBe(false);
  });
});

describe("isUnsubscribeReply", () => {
  it("reads the subject without its RE:/FW: prefixes", () => {
    expect(stripReplyPrefixes("RE: Fw: Re[2]: Unsubscribe")).toBe("Unsubscribe");
    expect(isUnsubscribeReply(reply("RE: Unsubscribe", ""))).toBe(true);
  });

  it("reads the first typed line, not the quoted campaign underneath", () => {
    const body = "Unsubscribe please\n\nFrom: Michael Mankin\nSent: Monday\n> Your rate review is due";
    expect(firstLine(body)).toBe("Unsubscribe please");
    expect(isUnsubscribeReply(reply("Re: Your rate review", body))).toBe(true);
  });

  it("ignores the campaign's own footer quoted in an ordinary reply", () => {
    const body = "Yes, Thursday works.\n\n> Unsubscribe\n> Click here to unsubscribe";
    expect(isUnsubscribeReply(reply("Re: Catch up?", body))).toBe(false);
  });

  it("never acts on out-of-office or bounce mail", () => {
    expect(isUnsubscribeReply(reply("Automatic reply: Unsubscribe", "Stop"))).toBe(false);
    expect(isUnsubscribeReply(reply("Unsubscribe", "Stop", "mailer-daemon@example.com"))).toBe(false);
  });
});

describe("isUnsubscribeMailboxRequest", () => {
  it("counts anything a person sends to the unsubscribe mailbox, whatever it says", () => {
    expect(isUnsubscribeMailboxRequest(reply("unsubscribe", ""))).toBe(true);
    expect(isUnsubscribeMailboxRequest(reply("", "Hi, can you take me off"))).toBe(true);
  });

  it("but not automated mail", () => {
    expect(isUnsubscribeMailboxRequest(reply("Out of office", "Back Monday"))).toBe(false);
    expect(isUnsubscribeMailboxRequest(reply("Undeliverable: x", "", "postmaster@example.com"))).toBe(false);
  });
});

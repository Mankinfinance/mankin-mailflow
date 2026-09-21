import { describe, it, expect } from "vitest";
import {
  looksLikeBounce,
  parseBounce,
  shouldSuppress,
  SOFT_BOUNCE_LIMIT,
} from "./bounces";

const KNOWN = new Set(["a.fitzroy@bigpond.net.au", "j.tanner@hotmail.com"]);

/** A realistic Exchange Online NDR. */
const EXCHANGE_HARD = {
  from: "postmaster@mankinfinance.com",
  subject: "Undeliverable: Sarah, your ANZ rate is worth a look",
  body: [
    "Your message to a.fitzroy@bigpond.net.au couldn't be delivered.",
    "",
    "a.fitzroy   Recipient not found by SMTP address lookup",
    "",
    "Diagnostic information for administrators:",
    "Generating server: SY4PR01MB.aupr01.prod.outlook.com",
    "a.fitzroy@bigpond.net.au",
    "Remote server returned '550 5.1.1 RESOLVER.ADR.RecipNotFound; not found'",
    "Original message headers:",
    "From: michael@mankinfinance.com",
    "Cc: support@mankinfinance.com",
  ].join("\n"),
};

const POSTFIX_SOFT = {
  from: "MAILER-DAEMON@bigpond.net.au",
  subject: "Mail delivery failed: returning message to sender",
  body: [
    "This message was created automatically by mail delivery software.",
    "",
    "A message that you sent could not be delivered.",
    "",
    "  j.tanner@hotmail.com",
    "    host mx.hotmail.com said: 452 4.2.2 Mailbox full (in reply to RCPT TO)",
  ].join("\n"),
};

describe("looksLikeBounce", () => {
  it("recognises a daemon sender", () => {
    expect(looksLikeBounce({ from: "MAILER-DAEMON@x.com", subject: "hi", body: "" })).toBe(true);
    expect(looksLikeBounce({ from: "postmaster@mankinfinance.com", subject: "hi", body: "" })).toBe(true);
  });

  it("recognises the common failure subjects", () => {
    for (const subject of [
      "Undeliverable: Rate update",
      "Delivery Status Notification (Failure)",
      "Mail delivery failed",
      "Returned mail: see transcript",
    ]) {
      expect(looksLikeBounce({ from: "someone@example.com", subject, body: "" })).toBe(true);
    }
  });

  it("leaves an ordinary reply alone", () => {
    expect(
      looksLikeBounce({
        from: "sarah@example.com",
        subject: "Re: your ANZ rate",
        body: "Thanks, can we chat Thursday?",
      }),
    ).toBe(false);
  });
});

describe("parseBounce", () => {
  it("reads a hard bounce out of an Exchange NDR", () => {
    const result = parseBounce(EXCHANGE_HARD, KNOWN)!;
    expect(result.email).toBe("a.fitzroy@bigpond.net.au");
    expect(result.kind).toBe("hard");
    expect(result.statusCode).toBe("5.1.1");
    expect(result.diagnostic).toContain("550 5.1.1");
  });

  it("reads a full mailbox as temporary", () => {
    const result = parseBounce(POSTFIX_SOFT, KNOWN)!;
    expect(result.email).toBe("j.tanner@hotmail.com");
    expect(result.kind).toBe("soft");
    expect(result.statusCode).toBe("4.2.2");
  });

  it("never suppresses our own addresses quoted in the bounce body", () => {
    // The NDR quotes the original headers, so michael@ and support@ both
    // appear. Only the address we actually mailed may be returned.
    const result = parseBounce(EXCHANGE_HARD, KNOWN)!;
    expect(result.email).not.toBe("michael@mankinfinance.com");
    expect(result.email).not.toBe("support@mankinfinance.com");
  });

  it("returns null when the bounced address is not one we mailed", () => {
    expect(parseBounce(EXCHANGE_HARD, new Set(["someone-else@example.com"]))).toBeNull();
  });

  it("returns null for a message that is not a bounce at all", () => {
    expect(
      parseBounce(
        {
          from: "sarah@example.com",
          subject: "Re: your ANZ rate",
          body: "Thanks! a.fitzroy@bigpond.net.au said the same thing.",
        },
        KNOWN,
      ),
    ).toBeNull();
  });

  it("treats a 5.2.2 over-quota as temporary despite the 5", () => {
    // Some servers code a full mailbox permanently. The person still
    // exists, so this must never remove them from the list.
    const result = parseBounce(
      {
        from: "postmaster@example.com",
        subject: "Undeliverable",
        body: "a.fitzroy@bigpond.net.au\n552 5.2.2 Over quota",
      },
      KNOWN,
    )!;
    expect(result.kind).toBe("soft");
  });

  it("treats a policy or throttling block as our problem, not the recipient's", () => {
    const result = parseBounce(
      {
        from: "postmaster@example.com",
        subject: "Undeliverable",
        body: "a.fitzroy@bigpond.net.au\n550 5.7.1 Message rejected due to sending policy",
      },
      KNOWN,
    )!;
    // A reputation block would otherwise delete the whole audience one
    // campaign at a time.
    expect(result.kind).toBe("soft");
  });

  it("classifies prose-only reports when the wording is unambiguous", () => {
    const hard = parseBounce(
      {
        from: "mailer-daemon@example.com",
        subject: "Failure notice",
        body: "Sorry, we were unable to deliver your message to a.fitzroy@bigpond.net.au. No such user here.",
      },
      KNOWN,
    )!;
    expect(hard.kind).toBe("hard");

    const soft = parseBounce(
      {
        from: "mailer-daemon@example.com",
        subject: "Failure notice",
        body: "Delivery to j.tanner@hotmail.com deferred: the mailbox is full, try again later.",
      },
      KNOWN,
    )!;
    expect(soft.kind).toBe("soft");
  });

  it("returns null rather than guessing when nothing identifies the failure", () => {
    expect(
      parseBounce(
        {
          from: "postmaster@example.com",
          subject: "Undeliverable",
          body: "Something went wrong with a.fitzroy@bigpond.net.au.",
        },
        KNOWN,
      ),
    ).toBeNull();
  });
});

describe("shouldSuppress", () => {
  const hard = { email: "a@b.com", kind: "hard" as const, diagnostic: "", statusCode: "5.1.1" };
  const soft = { email: "a@b.com", kind: "soft" as const, diagnostic: "", statusCode: "4.2.2" };

  it("removes a hard bounce immediately", () => {
    expect(shouldSuppress(hard, 0)).toBe(true);
  });

  it("gives a soft bounce room before giving up", () => {
    expect(shouldSuppress(soft, 0)).toBe(false);
    expect(shouldSuppress(soft, SOFT_BOUNCE_LIMIT - 2)).toBe(false);
    expect(shouldSuppress(soft, SOFT_BOUNCE_LIMIT - 1)).toBe(true);
  });
});

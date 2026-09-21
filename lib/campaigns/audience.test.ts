import { describe, it, expect } from "vitest";
import { resolveAudience } from "./audience";
import { AudienceFilterSchema, defaultAudienceFilter } from "./types";
import type { AudienceFilter } from "./types";
import type { SettlementRow } from "@/lib/commission-parser";
import type { Deal } from "@/lib/clients/salestrekker/types";

const TODAY = new Date("2026-08-24T00:00:00Z");

function settlement(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: "L-1",
    brokerName: "Michael Mankin",
    brokerId: "mm",
    clientName: "Sarah Chen",
    email: "sarah@example.com",
    lender: "ANZ",
    lenderCode: "ANZ",
    loanId: "L-1",
    settlementDate: "2024-03-15",
    settlementAmount: 640000,
    currentBalance: 610000,
    upfrontCommission: 4000,
    monthlyTrail: 90,
    loanStatus: "active",
    dischargeDate: null,
    source: { onUpfront: true, onTrail: true, onClawback: false },
    ...over,
  };
}

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "D-1",
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
    ...over,
  } as unknown as Deal;
}

function filter(over: Partial<AudienceFilter> = {}): AudienceFilter {
  return AudienceFilterSchema.parse(over);
}

describe("resolveAudience", () => {
  it("selects the active back-book by default", () => {
    const result = resolveAudience({
      filter: defaultAudienceFilter(),
      settlements: [
        settlement({ id: "a", email: "a@example.com" }),
        settlement({ id: "b", email: "b@example.com", loanStatus: "discharged" }),
      ],
      deals: [],
      today: TODAY,
    });
    expect(result.members.map((m) => m.sourceId)).toEqual(["a"]);
  });

  it("drops back-book rows with no email rather than guessing one", () => {
    const result = resolveAudience({
      filter: defaultAudienceFilter(),
      settlements: [settlement({ email: "" }), settlement({ id: "b", email: "b@example.com" })],
      deals: [],
      today: TODAY,
    });
    expect(result.members).toHaveLength(1);
    expect(result.droppedNoEmail).toBe(1);
  });

  it("mails a customer once when they are in both datasets, keeping the richer record", () => {
    const result = resolveAudience({
      filter: filter({ sources: ["settlements", "deals"] }),
      settlements: [settlement({ email: "Sarah@Example.com" })],
      deals: [deal({ email: "sarah@example.com" })],
      today: TODAY,
    });
    expect(result.members).toHaveLength(1);
    expect(result.members[0].sourceKind).toBe("settlements");
    expect(result.members[0].fields.current_balance).toBe("$610,000");
    expect(result.droppedDuplicate).toBe(1);
  });

  it("filters the back-book by settlement window, lender and balance", () => {
    const settlements = [
      settlement({ id: "old", email: "old@example.com", settlementDate: "2022-01-01" }),
      settlement({ id: "cba", email: "cba@example.com", lenderCode: "CBA" }),
      settlement({ id: "small", email: "small@example.com", currentBalance: 90_000 }),
      settlement({ id: "keep", email: "keep@example.com" }),
    ];
    const result = resolveAudience({
      filter: filter({
        settledFrom: "2023-01-01",
        lenderCodes: ["ANZ"],
        minBalance: 100_000,
      }),
      settlements,
      deals: [],
      today: TODAY,
    });
    expect(result.members.map((m) => m.sourceId)).toEqual(["keep"]);
  });

  it("honours the per-deal exclude-from-updates switch", () => {
    const result = resolveAudience({
      filter: filter({ sources: ["deals"] }),
      settlements: [],
      deals: [deal({ excludeFromDailyUpdates: true })],
      today: TODAY,
    });
    expect(result.members).toHaveLength(0);
  });

  it("can hold back deals the broker spoke to recently", () => {
    const deals = [
      deal({ id: "fresh", email: "fresh@example.com", daysSinceContact: 3 }),
      deal({ id: "stale", email: "stale@example.com", daysSinceContact: 60 }),
    ];
    const result = resolveAudience({
      filter: filter({ sources: ["deals"], excludeContactedWithinDays: 14 }),
      settlements: [],
      deals,
      today: TODAY,
    });
    expect(result.members.map((m) => m.sourceId)).toEqual(["stale"]);
  });

  it("builds merge fields the body can use, including years since settlement", () => {
    const result = resolveAudience({
      filter: defaultAudienceFilter(),
      settlements: [settlement()],
      deals: [],
      today: TODAY,
    });
    const fields = result.members[0].fields;
    expect(fields.first_name).toBe("Sarah");
    expect(fields.last_name).toBe("Chen");
    expect(fields.loan_status).toBe("active");
    expect(fields.lender).toBe("ANZ");
    expect(fields.loan_amount).toBe("$640,000");
    expect(fields.years_since_settlement).toBe("2");
    expect(fields.broker_name).toBe("Michael Mankin");
    expect(fields.broker_first_name).toBe("Michael");
  });

  it("lower-cases addresses so dedupe and suppression compare like for like", () => {
    const result = resolveAudience({
      filter: defaultAudienceFilter(),
      settlements: [settlement({ email: "  Sarah@Example.COM " })],
      deals: [],
      today: TODAY,
    });
    expect(result.members[0].email).toBe("sarah@example.com");
  });

  it("returns nobody when no source is selected", () => {
    const result = resolveAudience({
      filter: filter({ sources: [] }),
      settlements: [settlement()],
      deals: [deal()],
      today: TODAY,
    });
    expect(result.members).toHaveLength(0);
  });
});

describe("tag filtering", () => {
  const tags = {
    "sarah@example.com": ["Investor", "Self-employed"],
    "tom@example.com": ["First home buyer"],
  };

  function resolve(over: Partial<AudienceFilter>) {
    return resolveAudience({
      filter: filter({ sources: ["settlements", "deals"], ...over }),
      settlements: [settlement()],
      deals: [deal()],
      tagsByEmail: tags,
      today: TODAY,
    });
  }

  it("leaves the audience alone when no tag is named", () => {
    expect(resolve({}).members).toHaveLength(2);
  });

  it("keeps only contacts carrying an included tag", () => {
    const result = resolve({ includeTags: ["Investor"] });
    expect(result.members.map((m) => m.email)).toEqual(["sarah@example.com"]);
    expect(result.droppedByTag).toBe(1);
  });

  it("treats several included tags as any-of, not all-of", () => {
    // A broker tagging someone "investor" and "self-employed" is
    // describing them, not building a conjunction.
    const result = resolve({ includeTags: ["Investor", "First home buyer"] });
    expect(result.members).toHaveLength(2);
  });

  it("drops contacts carrying an excluded tag", () => {
    const result = resolve({ excludeTags: ["First home buyer"] });
    expect(result.members.map((m) => m.email)).toEqual(["sarah@example.com"]);
  });

  it("lets exclusion win over inclusion", () => {
    // "Not this group" is the stronger instruction: someone tagged both
    // should not be mailed on the strength of the weaker one.
    const result = resolve({
      includeTags: ["Investor"],
      excludeTags: ["Self-employed"],
    });
    expect(result.members).toHaveLength(0);
    expect(result.droppedByTag).toBe(2);
  });

  it("compares tags case-insensitively", () => {
    // Someone typed "Investor" on Monday and "investor" on Friday. They
    // meant the same label, and a filter that disagreed would silently
    // mail half the group.
    expect(resolve({ includeTags: ["investor"] }).members).toHaveLength(1);
    expect(resolve({ excludeTags: ["INVESTOR"] }).members).toHaveLength(1);
  });

  it("drops a contact with no tags at all when a tag is required", () => {
    const result = resolveAudience({
      filter: filter({ includeTags: ["Investor"] }),
      settlements: [settlement({ email: "untagged@example.com" })],
      deals: [],
      tagsByEmail: tags,
      today: TODAY,
    });
    expect(result.members).toHaveLength(0);
    expect(result.droppedByTag).toBe(1);
  });

  it("works with no tag map supplied at all", () => {
    // The automation runner resolves merge fields without one.
    const result = resolveAudience({
      filter: filter(),
      settlements: [settlement()],
      deals: [],
      today: TODAY,
    });
    expect(result.members).toHaveLength(1);
    expect(result.droppedByTag).toBe(0);
  });
});

describe("follow-up restriction", () => {
  it("keeps only addresses in the set", () => {
    const result = resolveAudience({
      filter: filter({ sources: ["settlements", "deals"] }),
      settlements: [settlement()],
      deals: [deal()],
      restrictToEmails: ["tom@example.com"],
      today: TODAY,
    });
    expect(result.members.map((m) => m.email)).toEqual(["tom@example.com"]);
    expect(result.droppedNotInSet).toBe(1);
  });

  it("reaches nobody when the set is empty", () => {
    // The honest answer when everyone opened the original: not "no
    // filter applied", which is what an undefined would mean.
    const result = resolveAudience({
      filter: filter(),
      settlements: [settlement()],
      deals: [],
      restrictToEmails: [],
      today: TODAY,
    });
    expect(result.members).toHaveLength(0);
    expect(result.droppedNotInSet).toBe(1);
  });

  it("does not restrict when no set is given", () => {
    const result = resolveAudience({
      filter: filter(),
      settlements: [settlement()],
      deals: [],
      today: TODAY,
    });
    expect(result.members).toHaveLength(1);
    expect(result.droppedNotInSet).toBe(0);
  });

  it("still applies every other clause", () => {
    // A follow-up is a narrowing, not a replacement: a contact excluded
    // by tag must stay excluded even though they never opened.
    const result = resolveAudience({
      filter: filter({ excludeTags: ["Do not chase"] }),
      settlements: [settlement()],
      deals: [],
      tagsByEmail: { "sarah@example.com": ["Do not chase"] },
      restrictToEmails: ["sarah@example.com"],
      today: TODAY,
    });
    expect(result.members).toHaveLength(0);
    expect(result.droppedByTag).toBe(1);
  });
});

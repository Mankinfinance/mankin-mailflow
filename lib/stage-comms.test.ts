import { describe, it, expect } from "vitest";
import {
  composeStageMilestoneEmail,
  hasStageComms,
  stageCommsLabel,
  STAGE_COMMS_STAGES,
} from "./stage-comms";
import { MANKIN_REVIEW_URL } from "./email-signature";
import type { Deal, StageId } from "./clients/salestrekker/types";

function deal(p: {
  stageId: StageId;
  name?: string;
  lender?: string;
  settlement?: string;
}): Deal {
  return {
    stageId: p.stageId,
    name: p.name ?? "Sarah Chen",
    lender: p.lender ?? "Westpac (proposed)",
    settlement: p.settlement ?? "TBD",
    applicants: [],
  } as unknown as Deal;
}

const ctx = { brokerShort: "Michael", brokerPhone: "0420 699 983", brokerId: "mm" };

describe("stage comms gating", () => {
  it("flags the run-to-settlement milestone stages, not the earlier ones", () => {
    expect(hasStageComms("cond-approved")).toBe(true);
    expect(hasStageComms("unconditional")).toBe(true);
    expect(hasStageComms("settle-booked")).toBe(true);
    expect(hasStageComms("settled")).toBe(true);
    expect(hasStageComms("pre-lodge")).toBe(false);
    expect(hasStageComms("lodged")).toBe(false);
    expect(hasStageComms("pre-approval")).toBe(false);
  });

  it("returns null for a stage with no milestone email", () => {
    expect(composeStageMilestoneEmail("pre-lodge", { deal: deal({ stageId: "pre-lodge" }), ...ctx })).toBeNull();
  });
});

describe("composeStageMilestoneEmail", () => {
  it("greets the customer and cleans the lender suffix", () => {
    const email = composeStageMilestoneEmail("unconditional", {
      deal: deal({ stageId: "unconditional", name: "Sarah Chen", lender: "Westpac (proposed)" }),
      ...ctx,
    })!;
    expect(email.body).toContain("Hi Sarah,");
    expect(email.body).toContain("Westpac");
    expect(email.body).not.toContain("(proposed)");
    expect(email.subject).toContain("Formal approval");
    expect(email.subject).toContain("Mankin Finance");
    expect(email.body).toContain("Michael");
  });

  it("includes the booked settlement date only when it is real", () => {
    const withDate = composeStageMilestoneEmail("settle-booked", {
      deal: deal({ stageId: "settle-booked", settlement: "14 Aug" }),
      ...ctx,
    })!;
    expect(withDate.body).toContain("for 14 Aug");

    const noDate = composeStageMilestoneEmail("settle-booked", {
      deal: deal({ stageId: "settle-booked", settlement: "TBD" }),
      ...ctx,
    })!;
    expect(noDate.body).not.toContain("for TBD");
    expect(noDate.body).toContain("Your settlement is booked.");
  });

  it("folds the Google review link into the settled email only", () => {
    const settled = composeStageMilestoneEmail("settled", { deal: deal({ stageId: "settled" }), ...ctx })!;
    expect(settled.body).toContain(MANKIN_REVIEW_URL);
    expect(settled.body.toLowerCase()).toContain("google review");

    const formal = composeStageMilestoneEmail("unconditional", { deal: deal({ stageId: "unconditional" }), ...ctx })!;
    expect(formal.body).not.toContain(MANKIN_REVIEW_URL);
  });

  it("falls back to a neutral lender phrase when the lender is a placeholder", () => {
    const email = composeStageMilestoneEmail("cond-approved", {
      deal: deal({ stageId: "cond-approved", lender: "TBC" }),
      ...ctx,
    })!;
    expect(email.body).toContain("the lender");
  });

  it("keeps every milestone body brand-voice safe (no em dashes, no exclamation marks)", () => {
    for (const stageId of STAGE_COMMS_STAGES) {
      const email = composeStageMilestoneEmail(stageId, { deal: deal({ stageId }), ...ctx })!;
      expect(email, `${stageId} should compose`).not.toBeNull();
      expect(email.body, `${stageId} body has an em dash`).not.toContain("—");
      expect(email.body, `${stageId} body has an exclamation mark`).not.toContain("!");
      expect(email.subject, `${stageId} subject has an em dash`).not.toContain("—");
    }
  });

  it("labels every milestone stage and nothing else", () => {
    expect(stageCommsLabel("settled")).toBe("Settled — congratulations");
    expect(stageCommsLabel("pre-lodge")).toBeNull();
    for (const s of STAGE_COMMS_STAGES) {
      expect(stageCommsLabel(s)).not.toBeNull();
    }
  });
});

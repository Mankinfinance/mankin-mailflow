import { describe, it, expect } from "vitest";
import { journeyForStage, LOAN_JOURNEY_STEPS } from "./loan-journey";
import type { StageId } from "./clients/salestrekker/types";

describe("journeyForStage", () => {
  it("maps each internal stage to the right customer milestone", () => {
    const cases: Array<[StageId, string]> = [
      ["pre-lodge", "started"],
      ["lodged", "submitted"],
      ["cond-approved", "conditional"],
      ["pre-approval", "conditional"], // pre-approval-only reads as conditional
      ["unconditional", "formal"],
      ["loan-docs", "documents"],
      ["settle-booked", "booked"],
      ["settled", "settled"],
    ];
    for (const [stage, key] of cases) {
      expect(journeyForStage(stage).currentStep.key, stage).toBe(key);
    }
  });

  it("marks past steps done, the current step current, and future steps upcoming", () => {
    const j = journeyForStage("unconditional"); // index 3 (formal)
    expect(j.currentIndex).toBe(3);
    expect(j.steps.slice(0, 3).every((s) => s.state === "done")).toBe(true);
    expect(j.steps[3].state).toBe("current");
    expect(j.steps.slice(4).every((s) => s.state === "upcoming")).toBe(true);
  });

  it("has no next step once settled and everything reads done/current", () => {
    const j = journeyForStage("settled");
    expect(j.nextStep).toBeNull();
    expect(j.currentIndex).toBe(LOAN_JOURNEY_STEPS.length - 1);
    expect(j.steps.every((s) => s.state === "done" || s.state === "current")).toBe(true);
  });

  it("exposes the next step early in the journey", () => {
    const j = journeyForStage("pre-lodge");
    expect(j.currentStep.key).toBe("started");
    expect(j.nextStep?.key).toBe("submitted");
  });
});

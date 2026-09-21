import type { StageId } from "./clients/salestrekker/types";

/**
 * The customer-facing view of a loan's progress. The broker pipeline runs
 * on Salestrekker's B.1-B.7 stages; a customer should never see that
 * jargon, so this collapses the eight internal stages into seven plain,
 * reassuring milestones and marks where the loan is up to.
 *
 * Pure (no server-only) so the portal client component and tests can both
 * use it. Copy is written to the brand voice — plain Australian English,
 * no exclamation marks, no jargon.
 */

export interface JourneyStepDef {
  key: string;
  /** Short label shown on the timeline. */
  label: string;
  /** Present-tense reassurance shown when this is the current step. */
  now: string;
}

export const LOAN_JOURNEY_STEPS: readonly JourneyStepDef[] = [
  {
    key: "started",
    label: "Application started",
    now: "We're putting your application together and getting your documents in order.",
  },
  {
    key: "submitted",
    label: "Submitted to lender",
    now: "Your application is with the lender and in their assessment queue.",
  },
  {
    key: "conditional",
    label: "Conditional approval",
    now: "The lender has approved your loan in principle, subject to a few standard conditions we're working through.",
  },
  {
    key: "formal",
    label: "Formal approval",
    now: "Your finance is formally approved. The lender has given the final tick.",
  },
  {
    key: "documents",
    label: "Loan documents",
    now: "Your loan documents are being prepared for signing.",
  },
  {
    key: "booked",
    label: "Settlement booked",
    now: "Settlement is booked. We're on the home stretch.",
  },
  {
    key: "settled",
    label: "Settled",
    now: "Your loan has settled. Everything is complete.",
  },
] as const;

export type JourneyState = "done" | "current" | "upcoming";

export interface JourneyStep extends JourneyStepDef {
  state: JourneyState;
}

export interface LoanJourney {
  steps: JourneyStep[];
  currentIndex: number;
  currentStep: JourneyStep;
  /** The step after the current one, or null at settled. */
  nextStep: JourneyStepDef | null;
}

/** Map an internal stage to the customer journey step index. Pre-approval-
 *  only sits with conditional approval from the customer's point of view. */
function stepIndexForStage(stageId: StageId): number {
  switch (stageId) {
    case "pre-lodge":
      return 0;
    case "lodged":
      return 1;
    case "cond-approved":
    case "pre-approval":
      return 2;
    case "unconditional":
      return 3;
    case "loan-docs":
      return 4;
    case "settle-booked":
      return 5;
    case "settled":
      return 6;
    default:
      return 0;
  }
}

export function journeyForStage(stageId: StageId): LoanJourney {
  const currentIndex = stepIndexForStage(stageId);
  const steps: JourneyStep[] = LOAN_JOURNEY_STEPS.map((s, i) => ({
    ...s,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
  }));
  return {
    steps,
    currentIndex,
    currentStep: steps[currentIndex],
    nextStep: LOAN_JOURNEY_STEPS[currentIndex + 1] ?? null,
  };
}

import { z } from "zod";

/**
 * Surveys: asking a client what they thought, and counting the answers.
 *
 * Mailchimp lists Surveys as its own feature and offers "send survey"
 * as an action in the automation builder. This is that, shaped for a
 * brokerage: the question worth asking after a settlement is whether
 * the client would recommend us, because referrals are most of where
 * the next loan comes from.
 *
 * Deliberately not a form. A form's job is to create a deal — a new
 * enquiry entering the pipeline. A survey's job is to hear from someone
 * already in the book, and its answers belong to a person we can
 * already name rather than to a stranger. That difference is why the
 * response page is reached by a signed token rather than being public:
 * we know who is answering without asking them to say.
 */

/* -------------------------------------------------------------------------- */
/* Questions                                                                  */
/* -------------------------------------------------------------------------- */

export const QuestionKindSchema = z.enum(["nps", "rating", "choice", "text"]);
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

export const SurveyQuestionSchema = z.object({
  id: z.string(),
  kind: QuestionKindSchema,
  /** The question as the client reads it. */
  prompt: z.string(),
  /** One line under the prompt, where the question needs framing. */
  help: z.string().optional(),
  /** choice: the options offered, in order. */
  options: z.array(z.string()).optional(),
  /** Whether an answer is needed before the response can be submitted. */
  required: z.boolean().default(false),
});

export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

export const SurveyConfigSchema = z.object({
  /** Shown above the questions. */
  headline: z.string().default("How did we do?"),
  intro: z.string().default(""),
  questions: z.array(SurveyQuestionSchema).default([]),
  /** Shown after submitting. The last thing a client reads. */
  thanks: z
    .string()
    .default("Thank you — that is genuinely useful, and it is read."),
  submitLabel: z.string().default("Send"),
});

export type SurveyConfig = z.infer<typeof SurveyConfigSchema>;

export const SurveyStatusSchema = z.enum(["draft", "live", "closed"]);
export type SurveyStatus = z.infer<typeof SurveyStatusSchema>;

/** An answer per question id. Numbers for nps/rating, strings otherwise. */
export const SurveyAnswersSchema = z.record(
  z.string(),
  z.union([z.number(), z.string()]),
);
export type SurveyAnswers = z.infer<typeof SurveyAnswersSchema>;

/* -------------------------------------------------------------------------- */
/* The scales                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * NPS is asked 0-10 and bucketed 0-6 / 7-8 / 9-10. The buckets are not
 * ours to reinvent: the whole point of using the standard question is
 * that the number means the same thing as everyone else's.
 */
export const NPS_MIN = 0;
export const NPS_MAX = 10;
export const RATING_MAX = 5;

export type NpsBucket = "detractor" | "passive" | "promoter";

export function npsBucket(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export const NPS_BUCKET_LABELS: Record<NpsBucket, string> = {
  promoter: "Would recommend",
  passive: "Satisfied, not enthusiastic",
  detractor: "Would not recommend",
};

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  /** Rough idea of when to send it, for the card. */
  when: string;
  config: SurveyConfig;
}

/**
 * Two surveys a brokerage actually runs. Both are short on purpose:
 * every extra question costs responses, and the difference between an
 * 11% and a 40% response rate is usually the length of the thing.
 */
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    id: "post-settlement-nps",
    name: "After settlement",
    description:
      "The standard recommend question, plus room to say why. Two questions.",
    when: "A week or two after settlement, while it is fresh",
    config: {
      headline: "How did we do, {{first_name}}?",
      intro:
        "Your loan has settled, so this is the right moment to ask. Two questions, about a minute.",
      questions: [
        {
          id: "nps",
          kind: "nps",
          prompt:
            "How likely would you be to recommend Mankin Finance to a friend or family member?",
          help: "0 is not at all likely, 10 is extremely likely.",
          required: true,
        },
        {
          id: "why",
          kind: "text",
          prompt: "What made you answer that way?",
          help: "Whatever comes to mind. It goes straight to your broker.",
          required: false,
        },
      ],
      thanks:
        "Thank you — that is genuinely useful, and your broker reads every one of these.",
      submitLabel: "Send",
    },
  },
  {
    id: "process-check",
    name: "How the process felt",
    description:
      "Where the application felt slow or unclear. Three questions.",
    when: "Just after approval, before the detail fades",
    config: {
      headline: "How did the application feel?",
      intro:
        "We are trying to make this less painful than it usually is. Telling us where it was not helps.",
      questions: [
        {
          id: "clarity",
          kind: "rating",
          prompt: "How clear was it what we needed from you, and when?",
          required: true,
        },
        {
          id: "slowest",
          kind: "choice",
          prompt: "Which part felt slowest?",
          options: [
            "Gathering documents",
            "Waiting on the lender",
            "Hearing back from us",
            "Nothing felt slow",
          ],
          required: false,
        },
        {
          id: "improve",
          kind: "text",
          prompt: "What would have made it easier?",
          required: false,
        },
      ],
      thanks: "Thank you. Specific answers here have changed how we work.",
      submitLabel: "Send",
    },
  },
];

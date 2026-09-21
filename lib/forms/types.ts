import { z } from "zod";

/**
 * The acquisition surfaces: forms that collect an enquiry and put it
 * straight into the loan pipeline.
 *
 * The principle the whole module is built around — a submission creates
 * a deal, not a list entry. A form that only grows a mailing list is a
 * form nobody follows up, and an enquiry that sits outside the pipeline
 * is an enquiry the daily queue never surfaces.
 */

export const FormTypeSchema = z.enum(["popup", "embedded", "promotion"]);
export type FormType = z.infer<typeof FormTypeSchema>;

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  popup: "Pop-up",
  embedded: "Embedded form",
  promotion: "Promotion",
};

export const FORM_TYPE_BLURBS: Record<FormType, string> = {
  popup: "Appears over the page. Best for a single, well-timed ask.",
  embedded: "Sits inside a page as part of the content.",
  promotion: "A bar or banner that stays visible while someone reads.",
};

/** Fields a broker can ask for. Deliberately short — every extra field
 *  costs completions, and anything else can be asked on the call. */
export const FormFieldSchema = z.enum([
  "name",
  "email",
  "phone",
  "loan-purpose",
  "message",
]);
export type FormField = z.infer<typeof FormFieldSchema>;

export const FIELD_LABELS: Record<FormField, string> = {
  name: "Full name",
  email: "Email",
  phone: "Phone",
  "loan-purpose": "What are you looking to do?",
  message: "Anything we should know?",
};

/**
 * Where a submission lands. "pipeline" creates a deal at the chosen
 * stage; "register-only" records the enquiry without one, for a form
 * that genuinely is just a content download.
 */
export const FormDestinationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pipeline"),
    stageId: z.string().default("pre-lodge"),
    /** Broker the deal is assigned to. */
    brokerId: z.string(),
  }),
  z.object({ kind: z.literal("register-only") }),
]);
export type FormDestination = z.infer<typeof FormDestinationSchema>;

export const FormConfigSchema = z.object({
  headline: z.string().default("Talk to a broker"),
  blurb: z.string().default(""),
  buttonLabel: z.string().default("Send"),
  /** Shown after a successful submission. */
  thanks: z.string().default("Thanks — we will be in touch shortly."),
  fields: z.array(FormFieldSchema).default(["name", "email", "phone"]),
  /** Consent line. Required text, so it cannot be edited away. */
  consent: z
    .string()
    .default(
      "By sending this you agree we can contact you about your enquiry.",
    ),
  destination: FormDestinationSchema,
});

export type FormConfig = z.infer<typeof FormConfigSchema>;

export const FormStatusSchema = z.enum(["draft", "live", "paused"]);
export type FormStatus = z.infer<typeof FormStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export const FORM_CATEGORIES = [
  "Lead generation",
  "Resource sharing",
  "Event sign-up",
  "Re-engagement",
] as const;

export type FormCategory = (typeof FORM_CATEGORIES)[number];

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: FormCategory;
  type: FormType;
  config: Omit<FormConfig, "destination"> & {
    destination: Extract<FormDestination, { kind: "pipeline" }> | { kind: "register-only" };
  };
}

/**
 * The gallery. Every template asks for as little as it can get away
 * with and lands somewhere a broker will actually see it — no
 * spin-to-win, no mystery discount, because a mortgage is not an
 * impulse purchase and a gimmick on a credit licensee's site reads as
 * exactly that.
 */
export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: "home-loan-enquiry",
    name: "Home loan enquiry",
    description: "The everyday one. Name, email, phone, and what they want to do.",
    category: "Lead generation",
    type: "embedded",
    config: {
      headline: "Talk to a broker",
      blurb:
        "Tell us what you are trying to do and we will come back with what is possible.",
      buttonLabel: "Send enquiry",
      thanks: "Thanks — a broker will be in touch within one business day.",
      fields: ["name", "email", "phone", "loan-purpose"],
      consent:
        "By sending this you agree we can contact you about your enquiry.",
      destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    },
  },
  {
    id: "refinance-health-check",
    name: "Refinance health check",
    description: "For the rate-shopper. Asks the current lender up front.",
    category: "Lead generation",
    type: "embedded",
    config: {
      headline: "Is your rate still competitive?",
      blurb:
        "Send us where your loan is now and we will tell you honestly whether moving is worth it.",
      buttonLabel: "Check my rate",
      thanks: "Thanks — we will come back with a straight answer either way.",
      fields: ["name", "email", "phone", "message"],
      consent:
        "By sending this you agree we can contact you about your enquiry.",
      destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    },
  },
  {
    id: "first-home-guide",
    name: "First home buyer guide",
    description: "A download in exchange for an address. Lands as a soft lead.",
    category: "Resource sharing",
    type: "popup",
    config: {
      headline: "The first home buyer guide",
      blurb:
        "What the deposit actually needs to be, which grants apply, and what lenders look at.",
      buttonLabel: "Send me the guide",
      thanks: "On its way to your inbox.",
      fields: ["name", "email"],
      consent:
        "By sending this you agree we can email you the guide and follow up once.",
      destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    },
  },
  {
    id: "borrowing-capacity",
    name: "Borrowing capacity check",
    description: "High intent — someone doing this is close to looking.",
    category: "Lead generation",
    type: "embedded",
    config: {
      headline: "What could you actually borrow?",
      blurb:
        "A broker will run the numbers properly rather than giving you a calculator answer.",
      buttonLabel: "Find out",
      thanks: "Thanks — we will come back with a real number, not an estimate.",
      fields: ["name", "email", "phone"],
      consent:
        "By sending this you agree we can contact you about your enquiry.",
      destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    },
  },
  {
    id: "seminar-registration",
    name: "Seminar registration",
    description: "For an evening session. Captures who is coming.",
    category: "Event sign-up",
    type: "embedded",
    config: {
      headline: "First home buyer evening",
      blurb: "Two hours, no obligation. Thursday, 6pm.",
      buttonLabel: "Save me a seat",
      thanks: "You are on the list — we will send the details closer to the date.",
      fields: ["name", "email", "phone"],
      consent:
        "By registering you agree we can contact you about this event.",
      destination: { kind: "register-only" },
    },
  },
  {
    id: "exit-intent-callback",
    name: "Leaving the rates page",
    description: "A last ask for someone about to close the tab.",
    category: "Re-engagement",
    type: "popup",
    config: {
      headline: "Want someone to just call you?",
      blurb: "Leave a number and a broker will ring at a time that suits.",
      buttonLabel: "Call me",
      thanks: "Thanks — we will ring shortly.",
      fields: ["name", "phone"],
      consent: "By sending this you agree we can call you about your enquiry.",
      destination: { kind: "pipeline", stageId: "pre-lodge", brokerId: "mm" },
    },
  },
  {
    id: "rate-alert-bar",
    name: "Rate movement alert",
    description: "A slim bar that collects an address for rate updates.",
    category: "Re-engagement",
    type: "promotion",
    config: {
      headline: "Tell me when rates move",
      blurb: "",
      buttonLabel: "Keep me posted",
      thanks: "Done — we will let you know when something changes.",
      fields: ["email"],
      consent:
        "By subscribing you agree we can email you about rate movements. You can unsubscribe at any time.",
      destination: { kind: "register-only" },
    },
  },
];

/** A blank form for someone starting from scratch. */
export function emptyFormConfig(brokerId: string): FormConfig {
  return FormConfigSchema.parse({
    destination: { kind: "pipeline", stageId: "pre-lodge", brokerId },
  });
}

/**
 * Conversion rate as a percentage of views, or null when the form has
 * not been seen yet. Null rather than 0% — a form nobody has loaded has
 * not failed to convert, it has not been tried.
 */
export function conversionRate(
  submissions: number,
  views: number,
): number | null {
  if (views <= 0) return null;
  return (submissions / views) * 100;
}

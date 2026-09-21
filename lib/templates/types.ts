import { z } from "zod";

/**
 * Saved email templates — the body of a campaign, kept so it can be
 * written once and sent many times.
 *
 * Two sources feed one gallery. The built-in library below ships in
 * code, so the module is useful the first time a broker opens it rather
 * than after they have populated it themselves. Saved templates come
 * from the database and sit above the library, because a template
 * someone here wrote for this firm beats a starting point every time.
 *
 * A template carries a subject as well as a body. Separating them would
 * mean a broker picks "Rate review" and then has to invent a subject
 * line for it, which is the part they were most likely stuck on.
 *
 * Pure module: schema and literals only, no server imports, so the
 * tests can exercise the library without a database.
 */

export const TEMPLATE_CATEGORIES = [
  "Rate review",
  "Market update",
  "Anniversary",
  "Re-engagement",
  "Seasonal",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORIES);

/**
 * The stored shape. Kept deliberately close to a campaign's own fields
 * — name, subject, body — so "save this campaign as a template" and
 * "start a campaign from this template" are both copies rather than
 * translations.
 */
export const TemplateConfigSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
  category: TemplateCategorySchema.default("Market update"),
  /** One line on the card, saying when to reach for it. */
  description: z.string().default(""),
});

export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;

export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Lucide icon name, resolved in the UI. */
  icon: string;
  subject: string;
  body: string;
}

/** Terse construction for the library below. */
function tpl(args: {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  subject: string;
  lines: string[];
}): BuiltInTemplate {
  return { ...args, body: args.lines.join("\n") };
}

/**
 * The library.
 *
 * Every one is an email a mortgage brokerage actually sends, written
 * against merge fields the loan book can already answer. None of them
 * is a newsletter about nothing, because the reason a broker's list
 * goes stale is sending those.
 *
 * They are written to be edited. The placeholders in square brackets
 * are the parts only the broker knows, and the spam checker in the
 * editor will flag them if they survive to send.
 */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  tpl({
    id: "fixed-rate-expiry",
    name: "Fixed rate expiring",
    description:
      "For a customer rolling off a fixed rate. The one email with a deadline attached.",
    category: "Rate review",
    icon: "calendar-clock",
    subject: "{{first_name}}, your {{lender}} fixed rate ends soon",
    lines: [
      "Hi {{first_name}},",
      "",
      "Your fixed rate with {{lender}} is coming to an end. When it does, the loan reverts to that lender's variable rate, which is almost never their best one.",
      "",
      "There are three ways this goes:",
      "- Re-fix with {{lender}} at whatever they offer you",
      "- Move to their variable rate and negotiate it down",
      "- Refinance elsewhere if the numbers are better",
      "",
      "Worth fifteen minutes before it rolls over rather than after.",
      "",
      "[Book a time](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "rate-review",
    name: "Rate review",
    description:
      "The everyday one. Ask whether the rate they signed is still the rate they should be paying.",
    category: "Rate review",
    icon: "percent",
    subject: "{{first_name}}, is your rate still competitive?",
    lines: [
      "Hi {{first_name}},",
      "",
      "Lenders price new customers better than existing ones. It is not personal, it is just how the book works — which means a rate that was sharp when you settled with {{lender}} may not be any more.",
      "",
      "I can check yours against what is available now. If you are already on a good deal I will tell you that and we will leave it alone.",
      "",
      "[Check my rate](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "annual-check-in",
    name: "Annual check-in",
    description:
      "A year on from settlement. Low pressure, opens the door to everything else.",
    category: "Anniversary",
    icon: "cake",
    subject: "{{first_name}}, your loan turns one",
    lines: [
      "Hi {{first_name}},",
      "",
      "It has been a year since your loan settled with {{lender}}. Worth a quick look at three things:",
      "",
      "- Whether the rate is still where it should be",
      "- Whether the repayment structure still suits you",
      "- Whether an offset would be earning its keep by now",
      "",
      "No obligation on any of it. If everything is working, that is a good answer too.",
      "",
      "[Book a review](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "cash-rate-move",
    name: "Cash rate decision",
    description:
      "After an RBA announcement. Send within a day or two or it reads as old news.",
    category: "Market update",
    icon: "trending-up",
    subject: "What yesterday's rate decision means for your loan",
    lines: [
      "Hi {{first_name}},",
      "",
      "The RBA [held / moved] the cash rate yesterday. What that means for you depends less on the decision than on what {{lender}} does with it, and lenders do not all pass changes on the same way or at the same speed.",
      "",
      "I am watching what each lender does over the next fortnight. If {{lender}} moves in a way that leaves you worse off than you should be, I will let you know.",
      "",
      "If you would rather not wait:",
      "",
      "[Book a time](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "property-market",
    name: "Local market update",
    description:
      "Quarterly. What is actually happening in the suburbs your customers bought in.",
    category: "Market update",
    icon: "house",
    subject: "What the [suburb] market is actually doing",
    lines: [
      "Hi {{first_name}},",
      "",
      "A short one on what has moved locally this quarter:",
      "",
      "- [Median and direction]",
      "- [Days on market]",
      "- [What that means for equity]",
      "",
      "If you have been wondering whether there is enough equity to do something with — an investment, a renovation, consolidating something expensive — that is a question I can answer in about ten minutes.",
      "",
      "[Ask the question](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "equity-check",
    name: "Equity check",
    description:
      "For customers a few years in. Most have more equity than they think and no idea what it is for.",
    category: "Re-engagement",
    icon: "layers",
    subject: "{{first_name}}, you may have more equity than you think",
    lines: [
      "Hi {{first_name}},",
      "",
      "Between what you have paid down and what has happened to prices, the gap between what your property is worth and what you owe {{lender}} is probably wider than it was.",
      "",
      "That gap is useful. It can fund a deposit on an investment, a renovation, or clearing something at a much worse rate.",
      "",
      "Happy to work out where you actually stand before you decide whether to do anything with it.",
      "",
      "[Find out](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "quiet-customer",
    name: "Been a while",
    description:
      "For the back-book you have not spoken to in years. Honest about the silence.",
    category: "Re-engagement",
    icon: "undo-2",
    subject: "{{first_name}}, it has been a while",
    lines: [
      "Hi {{first_name}},",
      "",
      "We have not spoken since your loan settled, which is my fault rather than yours.",
      "",
      "Things worth knowing: rates have moved, lender policy has moved, and the deal you have now may not be the deal you would get today. None of that is urgent, but none of it fixes itself either.",
      "",
      "If it is worth a conversation, I am here. If not, no hard feelings — and the unsubscribe link below works properly.",
      "",
      "[Book a time](https://tidycal.com/mankinfinance)",
    ],
  }),
  tpl({
    id: "eofy",
    name: "End of financial year",
    description:
      "June. Investment customers especially — the deductibility questions land now.",
    category: "Seasonal",
    icon: "receipt",
    subject: "{{first_name}}, a few things worth doing before 30 June",
    lines: [
      "Hi {{first_name}},",
      "",
      "A short list before the financial year closes:",
      "",
      "- Get your interest summary from {{lender}} for your accountant",
      "- If the property is an investment, check the loan is structured the way your accountant assumed",
      "- If you have been meaning to review the rate, doing it now keeps the paperwork in one year",
      "",
      "I am not your accountant and this is not tax advice — but I can get the loan side in order before you sit down with them.",
      "",
      "[Book a time](https://tidycal.com/mankinfinance)",
    ],
  }),
];

/** Look one up by id. */
export function builtInTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

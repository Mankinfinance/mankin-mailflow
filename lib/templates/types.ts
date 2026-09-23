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
  "Welcome & settlement",
  "Pipeline",
  "Goals",
  "Explainers",
  "Referrals & reviews",
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
 * House rules, each enforced by a test rather than by memory:
 *  - no em dashes, which the firm keeps out of client email
 *  - no exclamation marks
 *  - the booking link is always {{booking_url}}, the sending broker's
 *    own calendar; without one it becomes "just reply to this email"
 *  - nothing the spam checker would warn about, apart from
 *    [placeholders], which it warns about on purpose so none is sent
 *  - {{lender}} only in templates for settled loans, since a new
 *    enquiry's deal has no lender yet
 *  - explainers and goals carry a general-information line
 */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  tpl({
    id: "fixed-rate-expiry",
    name: "Fixed rate expiring",
    description:
      "For a client rolling off a fixed rate. The one email with a real deadline attached.",
    category: "Rate review",
    icon: "calendar-clock",
    subject: "{{first_name}}, your {{lender}} fixed rate ends soon",
    lines: [
      "Hi {{first_name}},",
      "",
      "Your fixed rate with {{lender}} is coming to an end. When it does, the loan moves to that lender's variable rate, which is rarely their sharpest one.",
      "",
      "There are three ways this can go:",
      "- Re-fix with {{lender}} at whatever they offer you",
      "- Move to their variable rate and negotiate it down",
      "- Refinance elsewhere if the numbers are better",
      "",
      "It's worth fifteen minutes before it rolls over rather than after.",
      "",
      "[Book a time]({{booking_url}})",
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
      "Lenders tend to price new customers better than existing ones. It isn't personal, it's how the book works, which means a rate that was sharp when you settled with {{lender}} may not be any more.",
      "",
      "I can check yours against what's available now. If you're already on a good deal I'll tell you, and we'll leave it alone.",
      "",
      "[Check my rate]({{booking_url}})",
    ],
  }),
  tpl({
    id: "rate-cut-passed-on",
    name: "Was the cut passed on?",
    description:
      "After a cash rate cut. Checks the lender actually moved the client's rate, and by how much.",
    category: "Rate review",
    icon: "trending-down",
    subject: "{{first_name}}, did {{lender}} pass the rate cut on?",
    lines: [
      "Hi {{first_name}},",
      "",
      "When the cash rate falls, lenders decide for themselves how much of it to pass on, and to whom. New customers often see the full cut. Existing customers sometimes see less, or see it later.",
      "",
      "Your next repayment notice from {{lender}} will show your new rate. If it hasn't moved by the full amount, that's worth a conversation, and it's usually one I can have with them for you.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "new-customer-gap",
    name: "The new customer gap",
    description:
      "For clients a few years in. Explains why their rate drifts and offers to ask the lender to reprice.",
    category: "Rate review",
    icon: "scale",
    subject: "{{first_name}}, what {{lender}} offers new customers",
    lines: [
      "Hi {{first_name}},",
      "",
      "Most lenders keep their best pricing for new customers. Over a few years that gap can grow without anyone noticing, because the rate on your statement never changes on its own.",
      "",
      "Often the fix doesn't involve moving at all. I can ask {{lender}} to review your rate against what they're offering today, and they frequently agree to close some or all of the gap.",
      "",
      "If they won't, we'll know whether moving is worth it.",
      "",
      "[Ask for a review]({{booking_url}})",
    ],
  }),
  tpl({
    id: "reprice-not-refinance",
    name: "Reprice, don't refinance",
    description:
      "For clients who assume a better rate means paperwork. Makes the easy option clear.",
    category: "Rate review",
    icon: "refresh-cw",
    subject: "A lower rate without changing lenders",
    lines: [
      "Hi {{first_name}},",
      "",
      "A lot of people put off looking at their rate because they assume it means refinancing, with new forms, valuations and a new lender.",
      "",
      "Often it doesn't. A repricing request to {{lender}} is a few emails from me, no new application, and the loan stays exactly where it is. Refinancing is only worth it if they won't move.",
      "",
      "Happy to find out which applies to you.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "cash-rate-move",
    name: "Cash rate decision",
    description:
      "After an RBA announcement. Send within a day or two or it reads as old news.",
    category: "Market update",
    icon: "trending-up",
    subject: "What the latest rate decision means for your loan",
    lines: [
      "Hi {{first_name}},",
      "",
      "The RBA [held / moved] the cash rate this week. What that means for you depends less on the decision than on what {{lender}} does next, and lenders don't all pass changes on the same way or at the same speed.",
      "",
      "I'm watching what each lender does over the next fortnight. If {{lender}} moves in a way that leaves you worse off than you should be, I'll let you know.",
      "",
      "If you'd rather not wait:",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "property-market",
    name: "Local market update",
    description:
      "Quarterly. What is actually happening in the suburbs your clients bought in.",
    category: "Market update",
    icon: "house",
    subject: "What the [suburb] market is actually doing",
    lines: [
      "Hi {{first_name}},",
      "",
      "A short one on what has moved locally this quarter:",
      "",
      "- [Median price and direction]",
      "- [Days on market]",
      "- [What that means for equity]",
      "",
      "If you've been wondering whether there's enough equity to do something with, whether that's an investment, a renovation or clearing something expensive, it's a question I can answer in about ten minutes.",
      "",
      "[Ask the question]({{booking_url}})",
    ],
  }),
  tpl({
    id: "lender-changes",
    name: "Lender changes this quarter",
    description:
      "Quarterly. The policy and pricing moves that matter, without the noise.",
    category: "Market update",
    icon: "landmark",
    subject: "What changed with the lenders this quarter",
    lines: [
      "Hi {{first_name}},",
      "",
      "Lenders changed a few things this quarter that are worth knowing about:",
      "",
      "- [Change one, in plain words]",
      "- [Change two]",
      "- [Change three]",
      "",
      "None of this needs action on its own. If one of them sounds like it applies to you, reply and I'll tell you whether it does.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "federal-budget",
    name: "Federal budget",
    description:
      "May. Only the parts that touch home owners and buyers.",
    category: "Market update",
    icon: "newspaper",
    subject: "What the budget means for home owners",
    lines: [
      "Hi {{first_name}},",
      "",
      "Most of the budget won't touch your loan. The parts that might:",
      "",
      "- [Housing or first home buyer measures]",
      "- [Tax changes that affect investors]",
      "- [Anything that affects borrowing power]",
      "",
      "If any of that changes your plans, it's worth a quick conversation before you act on it.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "annual-check-in",
    name: "Annual check-in",
    description:
      "A year on from settlement. Low pressure, and it opens the door to everything else.",
    category: "Anniversary",
    icon: "cake",
    subject: "{{first_name}}, your loan turns one",
    lines: [
      "Hi {{first_name}},",
      "",
      "It's been a year since your loan settled with {{lender}}. That makes it a good time to look at three things:",
      "",
      "- Whether the rate is still where it should be",
      "- Whether the repayments still suit you",
      "- Whether an offset account would be earning its keep by now",
      "",
      "You don't have to do anything with any of it. If everything is working, that's a good answer too.",
      "",
      "[Book a review]({{booking_url}})",
    ],
  }),
  tpl({
    id: "loan-anniversary-years",
    name: "Settlement anniversary",
    description:
      "For loans two years or more since settlement. Uses the number of years in the subject.",
    category: "Anniversary",
    icon: "calendar-heart",
    subject: "{{first_name}}, {{years_since_settlement}} years since settlement",
    lines: [
      "Hi {{first_name}},",
      "",
      "It's been {{years_since_settlement}} years since your loan with {{lender}} settled. A lot changes in that time: rates, your income, what the property is worth, and what you might want to do next.",
      "",
      "A review now covers where your rate sits against today's market, how much equity you've built, and whether the loan is still set up the way your life is.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "five-year-review",
    name: "Five years on",
    description:
      "The big anniversary. Equity and structure, not just rate.",
    category: "Anniversary",
    icon: "award",
    subject: "Five years on, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "Five years ago your loan settled with {{lender}}. Since then you've paid it down, and property values have likely moved as well.",
      "",
      "At this point the questions are usually bigger than the rate:",
      "- How much equity you actually have",
      "- Whether the loan structure still fits",
      "- What you might want the next five years to look like",
      "",
      "Worth half an hour to put real numbers to it.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "welcome-after-settlement",
    name: "Welcome, after settlement",
    description:
      "The first email after a loan settles. What happens next, and that we are still here.",
    category: "Welcome & settlement",
    icon: "key-round",
    subject: "Welcome to the other side of settlement, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "Your loan with {{lender}} has settled, and the hard part is done.",
      "",
      "A few things over the next few weeks:",
      "- {{lender}} will send your account details and first repayment date",
      "- Setting up online banking early makes everything after this easier",
      "- If you have an offset account, money in it starts saving you interest straight away",
      "",
      "After this I'll check in once a year to make sure the loan is still working for you. In between, if anything changes, just reply.",
      "",
      "Thank you for trusting us with it.",
    ],
  }),
  tpl({
    id: "three-months-in",
    name: "Three months in",
    description:
      "A light check-in once the first few repayments have gone through.",
    category: "Welcome & settlement",
    icon: "calendar-check",
    subject: "{{first_name}}, three months in",
    lines: [
      "Hi {{first_name}},",
      "",
      "You're about three months into your loan with {{lender}}, so the first few repayments have gone through.",
      "",
      "A quick check that everything is as expected:",
      "- Repayments coming out on the right day, for the right amount",
      "- Offset or redraw set up the way you wanted",
      "- Nothing from {{lender}} that's been confusing",
      "",
      "If all of that is fine, there's nothing to do. If anything isn't, reply and I'll sort it out.",
    ],
  }),
  tpl({
    id: "make-the-offset-work",
    name: "Getting the most from an offset",
    description:
      "For new settlements with an offset account. Practical, not a sales email.",
    category: "Welcome & settlement",
    icon: "piggy-bank",
    subject: "Making your offset account work harder",
    lines: [
      "Hi {{first_name}},",
      "",
      "An offset account reduces the balance you pay interest on, dollar for dollar. A few habits make a real difference:",
      "",
      "- Have your pay go straight into it",
      "- Keep savings there rather than in a separate account",
      "- Pay everyday spending on a card and clear it from the offset each month, if that suits how you manage money",
      "",
      "Every dollar sitting in the offset is a dollar you're not paying interest on.",
      "",
      "If you'd like to talk through how it fits with your finances:",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "new-enquiry-thanks",
    name: "Thanks for getting in touch",
    description:
      "For a new website enquiry. Sets expectations about what happens next.",
    category: "Pipeline",
    icon: "message-circle",
    subject: "Thanks for getting in touch, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "Thanks for reaching out. I'll be in touch shortly, but so you know what to expect:",
      "",
      "- First, a short call to understand what you're trying to do",
      "- Then I'll let you know what documents we'll need",
      "- From there, I'll come back with options that fit your situation",
      "",
      "If it's easier to pick a time now:",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "preapproval-expiring",
    name: "Pre-approval expiring",
    description:
      "For clients whose pre-approval is close to lapsing. Keeps it current without pressure.",
    category: "Pipeline",
    icon: "hourglass",
    subject: "{{first_name}}, your pre-approval is close to expiring",
    lines: [
      "Hi {{first_name}},",
      "",
      "Your pre-approval is coming up to its expiry date. Most last around three months, and once one lapses the lender needs fresh paperwork to reissue it.",
      "",
      "If you're still looking, it's easier to renew it now than to find the right property and discover it has expired. If your plans have changed, that's fine too, just let me know.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "still-house-hunting",
    name: "Still house hunting?",
    description:
      "For pre-approved clients who have gone quiet. Offers help, not a push.",
    category: "Pipeline",
    icon: "search",
    subject: "Still looking, {{first_name}}?",
    lines: [
      "Hi {{first_name}},",
      "",
      "Just checking in on the search. It can take longer than anyone expects, and the market doesn't always cooperate.",
      "",
      "A few things I can help with while you look:",
      "- Checking your borrowing position is still current",
      "- Talking through a property before you make an offer",
      "- Being ready to move quickly when the right one turns up",
      "",
      "Reply any time, even if it's just to say you're still going.",
    ],
  }),
  tpl({
    id: "application-update",
    name: "Where your application is up to",
    description:
      "For a lodged application with nothing new to report. Silence worries people.",
    category: "Pipeline",
    icon: "clipboard-list",
    subject: "An update on your application",
    lines: [
      "Hi {{first_name}},",
      "",
      "A quick update so you're not left wondering. Your application is with the lender and being assessed.",
      "",
      "Where it's at: [current stage]",
      "What happens next: [next step]",
      "",
      "No news at this stage is normal. As soon as I hear anything, you'll hear from me.",
    ],
  }),
  tpl({
    id: "went-quiet",
    name: "Did you end up buying?",
    description:
      "For enquiries that went cold. Honest, short, easy to answer.",
    category: "Pipeline",
    icon: "circle-help",
    subject: "{{first_name}}, did you end up going ahead?",
    lines: [
      "Hi {{first_name}},",
      "",
      "We spoke a while ago about a home loan, and I didn't want to lose touch.",
      "",
      "If you went ahead elsewhere, I hope it went well. If you paused, or you're ready to pick it back up, I'm happy to start from wherever you are now.",
      "",
      "Either way, a one-line reply is plenty.",
    ],
  }),
  tpl({
    id: "first-home-buyer",
    name: "First home, where to start",
    description:
      "For first home buyer enquiries. The order to do things in.",
    category: "Goals",
    icon: "house-plus",
    subject: "Buying your first home: where to start",
    lines: [
      "Hi {{first_name}},",
      "",
      "Buying a first home has a lot of moving parts. The order that usually works:",
      "",
      "- Work out what you can borrow before you fall for a property",
      "- Check which government schemes and stamp duty concessions you're eligible for",
      "- Get a pre-approval so you can make offers with confidence",
      "- Have a conveyancer lined up before you need one",
      "",
      "Government schemes can let some first home buyers purchase with a smaller deposit and without lenders mortgage insurance. Whether you qualify depends on your income, the price and where you're buying.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "investment-property",
    name: "Thinking about investing?",
    description:
      "For clients with equity who might be ready for an investment property.",
    category: "Goals",
    icon: "building-2",
    subject: "{{first_name}}, thinking about an investment property?",
    lines: [
      "Hi {{first_name}},",
      "",
      "A lot of investment purchases start with equity in the home you already own, rather than a new cash deposit.",
      "",
      "Before looking at properties, it helps to know three things:",
      "- How much usable equity you have",
      "- What you could borrow for an investment",
      "- How the loans should be structured, which matters for tax",
      "",
      "That last one is worth getting right at the start, alongside your accountant.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "renovation",
    name: "Planning a renovation?",
    description:
      "For clients who might be improving rather than moving.",
    category: "Goals",
    icon: "hammer",
    subject: "Funding a renovation, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "If you've been thinking about renovating, there are a few ways to fund it, and the right one depends on the size of the job:",
      "",
      "- Drawing on equity in your current loan, for smaller projects",
      "- A top-up or split loan, to keep the renovation money separate",
      "- A construction loan for major work, paid out in stages as it's built",
      "",
      "Getting the finance sorted before you sign with a builder avoids a lot of stress later.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "upgrading",
    name: "Thinking about your next home?",
    description:
      "For clients who may be outgrowing their first property.",
    category: "Goals",
    icon: "move-right",
    subject: "{{first_name}}, thinking about your next move?",
    lines: [
      "Hi {{first_name}},",
      "",
      "If your home is starting to feel small, the good news is that the equity you've built can go a long way towards the next one.",
      "",
      "The big question is usually timing: buy first, sell first, or bridge the gap between the two. Each has trade-offs, and the right answer depends on your numbers and how the market is moving.",
      "",
      "Happy to walk through them with you.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "consolidate-debts",
    name: "Tidying up other debts",
    description:
      "For clients carrying car loans or cards at higher rates. Honest about the trade-off.",
    category: "Goals",
    icon: "layers-3",
    subject: "Tidying up other debts, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "If you're carrying a car loan, personal loan or credit card, rolling them into your home loan can mean one lower repayment instead of several.",
      "",
      "It's worth being clear about the trade-off, though. Spreading a short debt over a long home loan can mean paying more interest overall, unless you keep paying it off quickly.",
      "",
      "Done carefully, it can still make a real difference to monthly cash flow. I'm happy to run the numbers both ways.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "self-employed",
    name: "Borrowing when you work for yourself",
    description:
      "For self-employed clients who assume borrowing will be hard.",
    category: "Goals",
    icon: "briefcase",
    subject: "Home loans when you're self-employed",
    lines: [
      "Hi {{first_name}},",
      "",
      "Lending when you work for yourself isn't harder so much as different. Lenders look at income in different ways, and some suit business owners far better than others.",
      "",
      "What usually helps:",
      "- Your last two years of tax returns and notices of assessment",
      "- Business financials your accountant is comfortable with",
      "- Knowing which lenders read your kind of income well",
      "",
      "If you've been told no before, it may just have been the wrong lender.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "fixed-vs-variable",
    name: "Fixed or variable",
    description:
      "A plain explainer. Useful when rates are in the news.",
    category: "Explainers",
    icon: "split",
    subject: "Fixed or variable: how to think about it",
    lines: [
      "Hi {{first_name}},",
      "",
      "One of the most common questions I get. There isn't a right answer for everyone, but there is a good way to think about it:",
      "",
      "- Fixed gives you certainty. Repayments don't change, but extra repayments are usually limited and breaking early can cost money",
      "- Variable gives you flexibility. Offset accounts and extra repayments usually come with it, but the rate can move either way",
      "- Splitting the loan lets you have some of each",
      "",
      "The choice usually comes down to how much certainty matters to you, and how likely you are to sell or refinance in the next few years.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "offset-vs-redraw",
    name: "Offset or redraw",
    description:
      "A plain explainer. The difference matters more than most people think.",
    category: "Explainers",
    icon: "arrow-left-right",
    subject: "Offset or redraw: what's the difference?",
    lines: [
      "Hi {{first_name}},",
      "",
      "Both can save you interest, but they work differently:",
      "",
      "- An offset account is a separate transaction account. Money in it reduces the balance you're charged interest on, and it's yours to use any time",
      "- Redraw is extra repayments you've made into the loan itself, which you can usually take back out",
      "",
      "The difference matters most if the property might become an investment later, because it can change what's tax deductible. That one is worth a word with your accountant.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "lmi-explained",
    name: "Lenders mortgage insurance, plainly",
    description:
      "A plain explainer for buyers with smaller deposits.",
    category: "Explainers",
    icon: "shield",
    subject: "Lenders mortgage insurance, in plain words",
    lines: [
      "Hi {{first_name}},",
      "",
      "Lenders mortgage insurance, or LMI, usually applies when you borrow more than 80 per cent of a property's value.",
      "",
      "Two things people often don't realise:",
      "- It protects the lender, not you, even though you pay for it",
      "- It can often be added to the loan, rather than paid up front",
      "",
      "Sometimes paying it is the right call, because it gets you into the market years sooner. Sometimes there's a way around it, such as a government scheme or a guarantor. It depends on your situation.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "borrowing-power",
    name: "What affects your borrowing power",
    description:
      "For anyone planning to buy or refinance in the next year.",
    category: "Explainers",
    icon: "gauge",
    subject: "What affects how much you can borrow",
    lines: [
      "Hi {{first_name}},",
      "",
      "A few things reduce borrowing power more than people expect:",
      "",
      "- Credit card limits count, even if the card is paid off every month",
      "- Buy now pay later accounts are counted too",
      "- HECS or HELP repayments come out of the income a lender uses",
      "- Living expenses are checked against your bank statements",
      "",
      "Small changes, like lowering an unused card limit, can make a real difference. If you're planning to buy or refinance, it's worth a check well before you apply.",
      "",
      "This is general information only and doesn't take your circumstances into account.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "google-review",
    name: "Ask for a Google review",
    description:
      "After a smooth settlement. Short, grateful, one link.",
    category: "Referrals & reviews",
    icon: "star",
    subject: "Would you mind leaving us a review, {{first_name}}?",
    lines: [
      "Hi {{first_name}},",
      "",
      "It was great helping you with your loan. If you have a spare minute, a short Google review would mean a lot. It's how other families find us, and we read every one.",
      "",
      "[Leave a review](https://share.google/4pkg33Qzcl47fhMHn)",
      "",
      "Thank you, {{first_name}}. It genuinely helps.",
    ],
  }),
  tpl({
    id: "referral-ask",
    name: "Know someone we could help?",
    description:
      "For happy clients. Asks for an introduction without pressure.",
    category: "Referrals & reviews",
    icon: "users",
    subject: "Know someone who could use a hand?",
    lines: [
      "Hi {{first_name}},",
      "",
      "Most of the people we help come to us through clients like you, and that's the part of the job I value most.",
      "",
      "If you know someone thinking about buying, refinancing or just wondering whether their rate is any good, I'd be glad to help them the same way. They're under no pressure, and I'll look after them.",
      "",
      "Just reply with their name and number, or pass on my details.",
    ],
  }),
  tpl({
    id: "referral-thanks",
    name: "Thank you for the introduction",
    description:
      "To a client who referred someone. Send once the introduction is made.",
    category: "Referrals & reviews",
    icon: "heart-handshake",
    subject: "Thank you, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "Thank you for introducing [name] to us. It means a lot that you'd trust us with someone you know.",
      "",
      "I'll look after them the same way we looked after you, and I'll keep you posted only as far as they're happy for me to.",
      "",
      "Thank you again.",
    ],
  }),
  tpl({
    id: "equity-check",
    name: "Equity check",
    description:
      "For clients a few years in. Most have more equity than they think and no plan for it.",
    category: "Re-engagement",
    icon: "layers",
    subject: "{{first_name}}, you may have more equity than you think",
    lines: [
      "Hi {{first_name}},",
      "",
      "Between what you've paid down and what has happened to prices, the gap between what your property is worth and what you owe {{lender}} is probably wider than it was.",
      "",
      "That gap is useful. It can fund a deposit on an investment, a renovation, or clearing something at a much higher rate.",
      "",
      "Happy to work out where you actually stand before you decide whether to do anything with it.",
      "",
      "[Find out]({{booking_url}})",
    ],
  }),
  tpl({
    id: "quiet-customer",
    name: "Been a while",
    description:
      "For the back-book you haven't spoken to in years. Honest about the silence.",
    category: "Re-engagement",
    icon: "undo-2",
    subject: "{{first_name}}, it's been a while",
    lines: [
      "Hi {{first_name}},",
      "",
      "We haven't spoken since your loan settled, which is my fault rather than yours.",
      "",
      "Rates have moved, lender policy has moved, and the deal you have now may not be the deal you'd get today. None of that is pressing, but none of it fixes itself either.",
      "",
      "If it's worth a conversation, I'm here. If not, no hard feelings, and the unsubscribe link below works properly.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "refinanced-away",
    name: "Checking in after you moved",
    description:
      "For clients whose loan with us has closed. Leaves the door open, gracefully.",
    category: "Re-engagement",
    icon: "door-open",
    subject: "Checking in, {{first_name}}",
    lines: [
      "Hi {{first_name}},",
      "",
      "I noticed your loan with {{lender}} has closed. If you've sold, refinanced elsewhere or paid it off, I hope it went smoothly.",
      "",
      "If you're ever weighing up a new purchase, a refinance, or just want a second opinion on the loan you have now, I'd be glad to help. No need to have used us last time.",
      "",
      "All the best.",
    ],
  }),
  tpl({
    id: "eofy",
    name: "End of financial year",
    description:
      "June. Investment clients especially, since the deductibility questions land now.",
    category: "Seasonal",
    icon: "receipt",
    subject: "{{first_name}}, a few things worth doing before 30 June",
    lines: [
      "Hi {{first_name}},",
      "",
      "A short list before the financial year closes:",
      "",
      "- Get your interest summary from {{lender}} for your accountant",
      "- If the property is an investment, check the loan is set up the way your accountant assumed",
      "- If you've been meaning to review the rate, doing it now keeps the paperwork in one year",
      "",
      "I'm not your accountant and this isn't tax advice, but I can get the loan side in order before you sit down with them.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "new-year",
    name: "New year check",
    description:
      "January. A light start-of-year nudge.",
    category: "Seasonal",
    icon: "sparkles",
    subject: "A quick loan check for the new year",
    lines: [
      "Hi {{first_name}},",
      "",
      "A new year is a good moment for a two-minute check:",
      "",
      "- Is your rate still competitive?",
      "- Are your repayments set at a level you're comfortable with?",
      "- Is anything coming up this year, such as a purchase, renovation or change in income, that the loan should be ready for?",
      "",
      "If any of those give you pause, let's talk.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "holiday-hours",
    name: "Holiday hours",
    description:
      "December. A thank you and the office closure dates.",
    category: "Seasonal",
    icon: "gift",
    subject: "Thank you, and our holiday hours",
    lines: [
      "Hi {{first_name}},",
      "",
      "Thank you for being part of our year. It's been a big one, and we don't take the trust you've placed in us for granted.",
      "",
      "Our office closes on [closing date] and reopens on [reopening date]. If something needs attention in between, reply to this email and we'll pick it up as soon as we're back.",
      "",
      "Wishing you and your family a restful break.",
    ],
  }),
  tpl({
    id: "spring-market",
    name: "Spring buying and selling",
    description:
      "September. For clients who might move during the busiest season.",
    category: "Seasonal",
    icon: "flower-2",
    subject: "Buying or selling this spring?",
    lines: [
      "Hi {{first_name}},",
      "",
      "Spring is usually the busiest time of year for property. More listings, more buyers, and things move quickly.",
      "",
      "If you're thinking about a move, it helps to have your finance ready before you start inspecting:",
      "- A current idea of your borrowing power",
      "- A pre-approval, so you can act when the right place appears",
      "- A plan for timing, if you're selling as well as buying",
      "",
      "Happy to help you get set up.",
      "",
      "[Book a time]({{booking_url}})",
    ],
  }),
  tpl({
    id: "tax-time",
    name: "Tax time paperwork",
    description:
      "July. The loan documents an accountant will ask for.",
    category: "Seasonal",
    icon: "file-text",
    subject: "Tax time: the loan paperwork you'll need",
    lines: [
      "Hi {{first_name}},",
      "",
      "If your accountant is preparing your return, they may ask for:",
      "",
      "- Your interest statement from {{lender}} for the year",
      "- Details of any redraws, especially on an investment loan",
      "- Any loan fees paid during the year",
      "",
      "{{lender}}'s online banking usually has these, or I can help you track them down. As always, your accountant is the one to ask about what's deductible.",
      "",
      "Reply if you need a hand.",
    ],
  }),
];

/** Look one up by id. */
export function builtInTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

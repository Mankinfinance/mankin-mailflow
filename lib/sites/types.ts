import { z } from "zod";

/**
 * Landing pages: a small, publishable page built from a fixed set of
 * blocks.
 *
 * Deliberately not a general page builder. A brokerage needs a handful
 * of pages that each do one job — explain a thing, then collect an
 * enquiry — and a freeform canvas would mean every page needs design
 * decisions nobody has time to make. A fixed block set means any page a
 * broker assembles is already on-brand and already responsive.
 *
 * The block that matters is `form`: it embeds a form built in the Forms
 * module, so a landing page inherits the same pipeline destination,
 * consent line and conversion tracking rather than inventing its own.
 */

export const BlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hero"),
    heading: z.string().default(""),
    sub: z.string().default(""),
  }),
  z.object({
    kind: z.literal("text"),
    heading: z.string().default(""),
    body: z.string().default(""),
  }),
  z.object({
    kind: z.literal("points"),
    heading: z.string().default(""),
    items: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("steps"),
    heading: z.string().default(""),
    items: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("quote"),
    quote: z.string().default(""),
    attribution: z.string().default(""),
  }),
  z.object({
    kind: z.literal("form"),
    heading: z.string().default(""),
    /** Form id from the Forms module. Empty until one is chosen. */
    formId: z.string().default(""),
  }),
]);

export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block["kind"];

export const BLOCK_LABELS: Record<BlockKind, string> = {
  hero: "Headline",
  text: "Paragraph",
  points: "Bullet points",
  steps: "Numbered steps",
  quote: "Client quote",
  form: "Enquiry form",
};

export const PageConfigSchema = z.object({
  blocks: z.array(BlockSchema).default([]),
  /** Shown in the browser tab and in search results. */
  metaTitle: z.string().default(""),
  metaDescription: z.string().default(""),
});

export type PageConfig = z.infer<typeof PageConfigSchema>;

export const PageStatusSchema = z.enum(["draft", "published"]);
export type PageStatus = z.infer<typeof PageStatusSchema>;

/**
 * URL slug rules. Lower-case, hyphenated, no leading or trailing
 * hyphen — the shape a page can live at without surprising anyone who
 * types it, and stable enough to print on a card.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 60;
}

/** Slugs the app already uses, which a page must not shadow. */
const RESERVED = new Set([
  "api", "dashboard", "marketing", "portal", "login", "audit",
  "reports", "templates", "styleguide", "f", "e", "p",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export const PAGE_CATEGORIES = [
  "Lead generation",
  "Resource",
  "Event",
] as const;

export type PageCategory = (typeof PAGE_CATEGORIES)[number];

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  category: PageCategory;
  slug: string;
  config: PageConfig;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: "refinance-check",
    name: "Refinance health check",
    description: "Explains what a review covers, then asks for the enquiry.",
    category: "Lead generation",
    slug: "refinance-health-check",
    config: {
      metaTitle: "Refinance health check · Mankin Finance",
      metaDescription:
        "Find out whether your current home loan is still competitive, from a broker who will tell you either way.",
      blocks: [
        {
          kind: "hero",
          heading: "Is your home loan still the right one?",
          sub: "A short review, and an honest answer — including when the answer is to stay where you are.",
        },
        {
          kind: "points",
          heading: "What we look at",
          items: [
            "Your current rate against what lenders are writing today",
            "What your balance would cost at that pricing",
            "Break costs and fees, so the comparison is the real one",
            "Whether splitting or offsetting would do more than moving",
          ],
        },
        {
          kind: "steps",
          heading: "How it works",
          items: [
            "You send a few details below",
            "We come back within a business day with what we find",
            "If moving is not worth it, we say so and that is the end of it",
          ],
        },
        { kind: "form", heading: "Start the check", formId: "" },
      ],
    },
  },
  {
    id: "first-home-guide",
    name: "First home buyer guide",
    description: "A resource page that trades the guide for an address.",
    category: "Resource",
    slug: "first-home-buyer-guide",
    config: {
      metaTitle: "The first home buyer guide · Mankin Finance",
      metaDescription:
        "What the deposit actually needs to be, which grants apply, and what lenders look at.",
      blocks: [
        {
          kind: "hero",
          heading: "Buying your first home, without the guesswork",
          sub: "A plain guide to deposits, grants and what lenders actually assess.",
        },
        {
          kind: "points",
          heading: "What is in it",
          items: [
            "How much deposit you need, and what counts towards it",
            "The grants and schemes available in Victoria right now",
            "What lenders look at besides your income",
            "The costs nobody mentions until settlement",
          ],
        },
        { kind: "form", heading: "Send me the guide", formId: "" },
      ],
    },
  },
  {
    id: "seminar",
    name: "Seminar registration",
    description: "Date, what is covered, and a sign-up.",
    category: "Event",
    slug: "first-home-buyer-evening",
    config: {
      metaTitle: "First home buyer evening · Mankin Finance",
      metaDescription:
        "Two hours, no obligation. What to expect and how to register.",
      blocks: [
        {
          kind: "hero",
          heading: "First home buyer evening",
          sub: "Two hours, no obligation, and nobody will ask you to sign anything.",
        },
        {
          kind: "text",
          heading: "What we cover",
          body: "A broker and a conveyancer walk through the whole process end to end — deposits and grants, what pre-approval actually means, what happens between an accepted offer and settlement, and the parts that most often catch people out. There is time for questions, and you are welcome to bring someone.",
        },
        { kind: "form", heading: "Save me a seat", formId: "" },
      ],
    },
  },
];

/** A blank page for someone starting from scratch. */
export function emptyPageConfig(): PageConfig {
  return {
    metaTitle: "",
    metaDescription: "",
    blocks: [
      { kind: "hero", heading: "A new page", sub: "" },
      { kind: "form", heading: "Get in touch", formId: "" },
    ],
  };
}

/** Problems that should stop a page being published. */
export function validatePage(config: PageConfig): string[] {
  const problems: string[] = [];
  if (config.blocks.length === 0) {
    problems.push("The page has no content yet.");
  }
  const forms = config.blocks.filter((b) => b.kind === "form");
  for (const block of forms) {
    if (block.kind === "form" && !block.formId) {
      problems.push("An enquiry block has no form chosen yet.");
    }
  }
  if (forms.length === 0) {
    problems.push(
      "The page has no enquiry form, so a visitor has no way to get in touch.",
    );
  }
  if (!config.metaTitle.trim()) {
    problems.push("Add a page title — it is what shows in search results.");
  }
  return [...new Set(problems)];
}

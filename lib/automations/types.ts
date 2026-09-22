import { z } from "zod";

/**
 * The automation flow model.
 *
 * Nodes are a flat list with explicit pointers rather than a nested
 * tree. A tree reads more naturally on paper, but it makes "where is
 * this contact up to" a path through nested arrays, and every engine
 * operation a recursive walk. A flat map with `next` / `nextYes` /
 * `nextNo` means a run's position is one node id, which is what makes
 * the engine testable and a stuck run diagnosable.
 */

/* -------------------------------------------------------------------------- */
/* Triggers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What puts someone into the sequence. Both triggers are derived from
 * data the firm already has — no separate enrolment step, no list to
 * maintain. That is the whole reason a brokerage can run automations at
 * all: the book already knows who is due.
 */
export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("settlement-anniversary"),
    /** Months after settlement, e.g. 12 for the annual review. */
    months: z.number().int().positive().default(12),
  }),
  z.object({
    kind: z.literal("pipeline-stage"),
    /** Stage the deal must be sitting in. */
    stageId: z.string(),
    /** How long it must have been there, in days. */
    afterDays: z.number().int().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal("form-submission"),
    /** The form whose enquiries start this sequence. */
    formId: z.string(),
  }),
  z.object({
    kind: z.literal("tag-added"),
    /** Compared case-insensitively, as tags are everywhere else. */
    tag: z.string(),
  }),
  z.object({
    /**
     * A loan crosses a share of its original balance paid down.
     *
     * This is where the brokerage equivalent of a birthday trigger
     * lands. Mailchimp's is a date on a contact record; there is no
     * birthday in a commission file and inventing the field would ship
     * a trigger that never fires. What the book does hold is what the
     * loan started at and what it sits at now, and a client who has
     * paid off a quarter of their loan is in a genuinely different
     * conversation from one who has not — equity, a top-up, a review.
     * A milestone from real data beats a date we would have to guess.
     */
    kind: z.literal("equity-milestone"),
    /** e.g. 25 for "has paid down a quarter of the original balance". */
    percentPaidDown: z.number().int().positive().max(100).default(25),
  }),
]);

export type Trigger = z.infer<typeof TriggerSchema>;

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

export const NodeKindSchema = z.enum(["delay", "send", "condition", "exit"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/**
 * What an If/Else can ask about the contact themselves, rather than
 * about the email they were last sent.
 *
 * Mailchimp's condition list is Birthday, VIP Status and Location —
 * facts about the person. Ours was only ever "did they open it", which
 * made every branch a question about the last send. These are the
 * brokerage's equivalents, drawn from the book: who the lender is,
 * what the loan is doing, who wrote it, what we have labelled them.
 *
 * Answered against the contact's CURRENT record, not the values frozen
 * when they entered. A branch asks a question about now — "are they
 * still with this lender" — and freezing it would have a sequence act
 * on a fact that stopped being true four months ago.
 */
export const DataConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tag"), tag: z.string() }),
  z.object({ kind: z.literal("lender"), codes: z.array(z.string()).min(1) }),
  z.object({
    kind: z.literal("balance"),
    /** Inclusive bounds in dollars. Either may be omitted for one-sided. */
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("loan-age"),
    /** Inclusive bounds in months since settlement. */
    minMonths: z.number().int().nonnegative().optional(),
    maxMonths: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("broker"), brokerIds: z.array(z.string()).min(1) }),
]);

export type DataCondition = z.infer<typeof DataConditionSchema>;

export const AutomationNodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,

  /** delay: how long to hold before continuing. */
  days: z.number().int().nonnegative().optional(),

  /** send: the email. Merge fields work exactly as in a campaign. */
  subject: z.string().optional(),
  body: z.string().optional(),
  /** A short label for the canvas, so a node reads without its subject. */
  label: z.string().optional(),

  /** condition: what to check about the most recent send. */
  check: z.enum(["opened", "clicked"]).optional(),
  /** How long to give it before deciding "no". */
  withinDays: z.number().int().positive().optional(),
  /**
   * condition: a question about the contact instead of the last send.
   *
   * Added alongside `check` rather than replacing it so every flow
   * already stored keeps parsing untouched — an engagement condition is
   * one with no `condition` set, which is exactly what the old rows
   * look like. When both are present this wins, and the editor only
   * ever sets one.
   */
  condition: DataConditionSchema.optional(),
  nextYes: z.string().nullable().optional(),
  nextNo: z.string().nullable().optional(),

  /** exit: why the sequence ends here, shown on the canvas. */
  note: z.string().optional(),

  /** Everything except a condition continues to one place. */
  next: z.string().nullable().optional(),
});

export type AutomationNode = z.infer<typeof AutomationNodeSchema>;

export const AutomationFlowSchema = z.object({
  trigger: TriggerSchema,
  /** Where a newly enrolled contact starts. */
  entryNodeId: z.string(),
  nodes: z.array(AutomationNodeSchema),
});

export type AutomationFlow = z.infer<typeof AutomationFlowSchema>;

export const AutomationStatusSchema = z.enum(["draft", "live", "paused"]);
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

/** A run's position in the sequence. */
export const RunStatusSchema = z.enum(["waiting", "running", "done", "exited"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The starting points offered on the empty state. Each is a flow a
 * brokerage actually runs, pre-wired against real triggers — the point
 * being that someone who has never built an automation should be able
 * to pick one, read it, and turn it on.
 */
export const TEMPLATE_CATEGORIES = [
  "Anniversary",
  "Reminder",
  "Re-engagement",
  "Welcome",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Lucide icon name, resolved in the UI. */
  icon: string;
  /** Rough volume, so a broker can judge before turning it on. */
  volume?: string;
  flow: AutomationFlow;
}

/** A send node built from the standard shape, to keep the library terse. */
function send(args: {
  id: string;
  label: string;
  subject: string;
  lines: string[];
  next: string | null;
}): AutomationNode {
  return {
    id: args.id,
    kind: "send",
    label: args.label,
    subject: args.subject,
    body: args.lines.join("\n"),
    next: args.next,
  };
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "annual-review",
    name: "12-month settlement anniversary",
    description:
      "Annual review, then one follow-up if it goes unopened.",
    category: "Anniversary",
    icon: "calendar-check",
    volume: "About 17 loans a month",
    flow: {
      trigger: { kind: "settlement-anniversary", months: 12 },
      entryNodeId: "send-review",
      nodes: [
        {
          id: "send-review",
          kind: "send",
          label: "Annual review",
          subject: "{{first_name}}, your loan turns one this month",
          body: [
            "Hi {{first_name}},",
            "",
            "Your {{lender}} loan settled a year ago, which makes now a sensible time to check it is still the right one.",
            "",
            "What a review covers:",
            "- whether your rate is still competitive",
            "- what {{current_balance}} would cost at today's pricing",
            "- whether your circumstances have changed enough to restructure",
            "",
            "[Book a 15-minute review]({{booking_url}})",
            "",
            "{{broker_name}}",
          ].join("\n"),
          next: "wait-5",
        },
        { id: "wait-5", kind: "delay", days: 5, next: "opened?" },
        {
          id: "opened?",
          kind: "condition",
          check: "opened",
          withinDays: 5,
          nextYes: "exit-opened",
          nextNo: "send-followup",
        },
        {
          id: "send-followup",
          kind: "send",
          label: "Annual review, follow-up",
          subject: "{{first_name}}, still worth a look",
          body: [
            "Hi {{first_name}},",
            "",
            "I wrote last week about your {{lender}} loan reaching a year. No reply needed if the timing is wrong — I will leave it there.",
            "",
            "If it is easier to talk it through:",
            "",
            "[Book a 15-minute review]({{booking_url}})",
            "",
            "{{broker_name}}",
          ].join("\n"),
          next: "exit-unopened",
        },
        {
          id: "exit-opened",
          kind: "exit",
          note: "Opened, nothing further. The broker picks it up from the pipeline instead.",
        },
        { id: "exit-unopened", kind: "exit", note: "Followed up once." },
      ],
    },
  },
  {
    id: "preapproval-cold",
    name: "Pre-approval going cold at 60 days",
    description:
      "One note from the owning broker while the approval still has time on it.",
    category: "Reminder",
    icon: "hourglass",
    volume: "A handful a month",
    flow: {
      trigger: { kind: "pipeline-stage", stageId: "pre-approval", afterDays: 60 },
      entryNodeId: "send-nudge",
      nodes: [
        {
          id: "send-nudge",
          kind: "send",
          label: "Pre-approval nudge",
          subject: "{{first_name}}, your pre-approval still has time on it",
          body: [
            "Hi {{first_name}},",
            "",
            "Your pre-approval has been sitting for a couple of months. It has not lapsed, but they do have an expiry, so it is worth knowing where you are up to.",
            "",
            "If you are still looking, there is nothing to do. If things have changed, tell me and I will sort out what happens next.",
            "",
            "{{broker_name}}",
            "{{broker_phone}}",
          ].join("\n"),
          next: "exit-nudged",
        },
        { id: "exit-nudged", kind: "exit", note: "Nudged once." },
      ],
    },
  },
  {
    id: "settling-in",
    name: "Three months after settlement",
    description:
      "Checks the first repayments landed and the offset is set up properly.",
    category: "Anniversary",
    icon: "house",
    volume: "About 17 loans a month",
    flow: {
      trigger: { kind: "settlement-anniversary", months: 3 },
      entryNodeId: "send-settling",
      nodes: [
        send({
          id: "send-settling",
          label: "Settling in",
          subject: "{{first_name}}, how are the first repayments sitting?",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your {{lender}} loan has been running about three months, which is usually when the first repayments have gone through and any wrinkles have shown up.",
            "",
            "Two things worth checking:",
            "- the repayment amount and date suit your pay cycle",
            "- your offset account is actually linked, if you have one",
            "",
            "If either needs sorting, reply and I will take care of it.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-settling",
        }),
        { id: "exit-settling", kind: "exit", note: "Checked in once." },
      ],
    },
  },
  {
    id: "two-year-repricing",
    name: "Two years since settlement",
    description:
      "A repricing conversation before the loyalty tax gets expensive.",
    category: "Anniversary",
    icon: "trending-up",
    volume: "About 12 loans a month",
    flow: {
      trigger: { kind: "settlement-anniversary", months: 24 },
      entryNodeId: "send-repricing",
      nodes: [
        send({
          id: "send-repricing",
          label: "Two-year repricing",
          subject: "{{first_name}}, two years on — worth repricing?",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your {{lender}} loan has been running two years. Lenders price new business better than existing business, so this is the point where a loan quietly drifts off the pace.",
            "",
            "I can ask {{lender}} to reprice, and if they will not move, look at what else is available on {{current_balance}}.",
            "",
            "[Book a 15-minute review]({{booking_url}})",
            "",
            "{{broker_name}}",
          ],
          next: "wait-repricing",
        }),
        { id: "wait-repricing", kind: "delay", days: 6, next: "repricing-opened?" },
        {
          id: "repricing-opened?",
          kind: "condition",
          check: "opened",
          withinDays: 6,
          nextYes: "exit-repricing-read",
          nextNo: "send-repricing-followup",
        },
        send({
          id: "send-repricing-followup",
          label: "Repricing follow-up",
          subject: "{{first_name}}, one line on your rate",
          lines: [
            "Hi {{first_name}},",
            "",
            "Short version of my last note: two years in, your rate is probably no longer the one {{lender}} gives new customers. It costs nothing to ask them.",
            "",
            "Say the word and I will make the call.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-repricing-followed",
        }),
        { id: "exit-repricing-read", kind: "exit", note: "Opened, broker picks it up." },
        { id: "exit-repricing-followed", kind: "exit", note: "Followed up once." },
      ],
    },
  },
  {
    id: "lodged-reassurance",
    name: "Two weeks at lodged with no news",
    description:
      "Says what is happening before the customer has to ask.",
    category: "Reminder",
    icon: "clock",
    volume: "Depends on lender turnaround",
    flow: {
      trigger: { kind: "pipeline-stage", stageId: "lodged", afterDays: 14 },
      entryNodeId: "send-lodged",
      nodes: [
        send({
          id: "send-lodged",
          label: "Still with the lender",
          subject: "{{first_name}}, where your application is up to",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your application is still with {{lender}}. Nothing has gone wrong — assessment queues run long at the moment, and no news at this stage is ordinary.",
            "",
            "I am watching it and will call the moment there is a decision. You do not need to do anything.",
            "",
            "{{broker_name}}",
            "{{broker_phone}}",
          ],
          next: "exit-lodged",
        }),
        { id: "exit-lodged", kind: "exit", note: "Reassured once." },
      ],
    },
  },
  {
    id: "settled-welcome",
    name: "Welcome, just after settlement",
    description:
      "Thanks them, sets out what happens next, and asks for a review.",
    category: "Welcome",
    icon: "party-popper",
    volume: "Every new settlement",
    flow: {
      trigger: { kind: "pipeline-stage", stageId: "settled", afterDays: 2 },
      entryNodeId: "send-welcome",
      nodes: [
        send({
          id: "send-welcome",
          label: "Welcome",
          subject: "{{first_name}}, you are settled",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your loan with {{lender}} has settled. Congratulations — the hard part is behind you.",
            "",
            "What happens from here:",
            "- your first repayment comes out on the date {{lender}} confirmed",
            "- I will check in at three months to make sure it is all sitting right",
            "- if anything looks wrong before then, call me, not the lender",
            "",
            "{{broker_name}}",
            "{{broker_phone}}",
          ],
          next: "exit-welcome",
        }),
        { id: "exit-welcome", kind: "exit", note: "Welcomed." },
      ],
    },
  },
  {
    id: "discharged-winback",
    name: "Refinanced away, six months on",
    description:
      "One honest note to a customer who left. Some come back.",
    category: "Re-engagement",
    icon: "undo-2",
    volume: "A few a month",
    flow: {
      trigger: { kind: "settlement-anniversary", months: 30 },
      entryNodeId: "send-winback",
      nodes: [
        send({
          id: "send-winback",
          label: "Win-back",
          subject: "{{first_name}}, no pitch, just a question",
          lines: [
            "Hi {{first_name}},",
            "",
            "I noticed your loan moved on from us a while back. That is completely fine — I am not writing to talk you out of it.",
            "",
            "If the new lender has since drifted on rate, or your circumstances have changed, I am happy to look at it with no expectation either way.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-winback",
        }),
        { id: "exit-winback", kind: "exit", note: "Asked once, left alone after." },
      ],
    },
  },

  /* ---- The three below are started by the newer triggers ---- */

  {
    id: "new-enquiry-welcome",
    name: "Welcome a new enquiry",
    description:
      "Answers a form enquiry straight away, then follows up once if nobody replies.",
    category: "Welcome",
    icon: "hand-heart",
    volume: "One per enquiry",
    flow: {
      /* Left blank deliberately: which form starts this is the one
         thing the broker has to choose, and validateFlow refuses to
         let it go live until they have. */
      trigger: { kind: "form-submission", formId: "" },
      entryNodeId: "send-welcome",
      nodes: [
        send({
          id: "send-welcome",
          label: "Thanks for getting in touch",
          subject: "Thanks {{first_name}} — here is what happens next",
          lines: [
            "Hi {{first_name}},",
            "",
            "Thanks for getting in touch. Your enquiry has come through and one of us will call you within one business day.",
            "",
            "Before that call it helps to have a rough idea of two things: what you are hoping to borrow, and when you would like to settle. No documents needed yet.",
            "",
            "{{broker_name}}",
          ],
          next: "wait-3",
        }),
        { id: "wait-3", kind: "delay", label: "Wait 3 days", days: 3, next: "opened" },
        {
          id: "opened",
          kind: "condition",
          label: "Opened it?",
          check: "opened",
          withinDays: 3,
          nextYes: "exit-welcome",
          nextNo: "send-nudge",
        },
        send({
          id: "send-nudge",
          label: "One nudge",
          subject: "{{first_name}}, did this reach you?",
          lines: [
            "Hi {{first_name}},",
            "",
            "I wrote a few days ago about your enquiry and have not heard back — which usually means it landed somewhere it should not have.",
            "",
            "If you are still looking, replying to this is enough and I will call you.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-welcome",
        }),
        { id: "exit-welcome", kind: "exit", note: "Handed to the broker from here." },
      ],
    },
  },

  {
    id: "tagged-followup",
    name: "Follow up a tagged contact",
    description:
      "Writes to anyone you tag, so labelling a client is the whole of the work.",
    category: "Reminder",
    icon: "tag",
    volume: "Depends how you tag",
    flow: {
      /* Same as the form above — the tag is the broker's to pick. */
      trigger: { kind: "tag-added", tag: "" },
      entryNodeId: "send-tagged",
      nodes: [
        send({
          id: "send-tagged",
          label: "Reach out",
          subject: "{{first_name}}, worth a quick look at your loan",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your {{lender}} loan has come up on my list for a review. Nothing is wrong — it is the sort of check worth doing once a year.",
            "",
            "If you would like me to run the numbers, reply and I will come back with where it sits.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-tagged",
        }),
        { id: "exit-tagged", kind: "exit", note: "One email per tag." },
      ],
    },
  },

  {
    id: "equity-milestone",
    name: "A quarter of the loan paid off",
    description:
      "Marks the milestone, and asks a different question of a large loan than a small one.",
    category: "Anniversary",
    icon: "trending-up",
    volume: "A handful a month",
    flow: {
      trigger: { kind: "equity-milestone", percentPaidDown: 25 },
      entryNodeId: "send-milestone",
      nodes: [
        send({
          id: "send-milestone",
          label: "Milestone",
          subject: "{{first_name}}, you have paid off a quarter of your loan",
          lines: [
            "Hi {{first_name}},",
            "",
            "Your {{lender}} loan has passed a quarter paid down. That is worth knowing about, because it changes two things: what the loan costs you, and what it could be used for.",
            "",
            "Happy to walk through either.",
            "",
            "{{broker_name}}",
          ],
          next: "big-loan",
        }),
        {
          /* A condition about the contact, not the email. This is the
             shape of every branch that asks something the book already
             knows — and it needs no waiting window, because the answer
             cannot change while we sit here. */
          id: "big-loan",
          kind: "condition",
          condition: { kind: "balance", min: 600_000 },
          nextYes: "send-structure",
          nextNo: "exit-milestone",
        },
        send({
          id: "send-structure",
          label: "Structure conversation",
          subject: "{{first_name}}, one thing worth checking at this size",
          lines: [
            "Hi {{first_name}},",
            "",
            "On a loan this size, a quarter paid down is usually the point where the structure is worth a second look — offset, splits, and whether the rate you are on is still the one you would be offered today.",
            "",
            "Half an hour would cover it.",
            "",
            "{{broker_name}}",
          ],
          next: "exit-milestone",
        }),
        { id: "exit-milestone", kind: "exit", note: "Marked once per loan." },
      ],
    },
  },
];

/** Blank flow for someone starting from an empty canvas. */
export function emptyFlow(): AutomationFlow {
  return {
    trigger: { kind: "settlement-anniversary", months: 12 },
    entryNodeId: "exit-1",
    nodes: [{ id: "exit-1", kind: "exit", note: "Nothing yet." }],
  };
}

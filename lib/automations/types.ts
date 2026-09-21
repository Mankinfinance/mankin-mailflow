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
]);

export type Trigger = z.infer<typeof TriggerSchema>;

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

export const NodeKindSchema = z.enum(["delay", "send", "condition", "exit"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

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
];

/** Blank flow for someone starting from an empty canvas. */
export function emptyFlow(): AutomationFlow {
  return {
    trigger: { kind: "settlement-anniversary", months: 12 },
    entryNodeId: "exit-1",
    nodes: [{ id: "exit-1", kind: "exit", note: "Nothing yet." }],
  };
}

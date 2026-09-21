/**
 * Pre-authored Salestrekker note templates. Broker selects one from a
 * dropdown in the deal drawer, edits the placeholders + adds context,
 * and the final text gets posted as a note on the deal — which then
 * flows to Salestrekker via SalestrekkerClient.addNote.
 *
 * Placeholders ({{lender}}, {{date}}, etc.) are intentionally
 * unreplaced — the broker fills them in via the textarea before
 * submitting. We could auto-substitute deal fields later but the
 * brand voice rules (plain Australian English, no exclamation marks,
 * never "happy") make broker-reviewed substitution safer than blind
 * templating.
 *
 * Edge-safe: no server imports, no DB calls. Used from both the
 * server (note-templates list) and client (AddNoteButton dropdown).
 */

export type NoteTemplateCategory =
  | "status"
  | "lender"
  | "customer"
  | "advisory"
  | "compliance";

export interface NoteTemplate {
  id: string;
  category: NoteTemplateCategory;
  /** Short label shown in the dropdown */
  label: string;
  /** One-line description shown under the label in the picker */
  description: string;
  /** Default body that pre-fills the textarea. Use {{placeholders}}
   *  the broker should replace before posting. */
  body: string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  /* ─── Status updates ──────────────────────────────────────────── */
  {
    id: "status-docs-complete",
    category: "status",
    label: "Docs collection complete",
    description: "All requested docs received, ready to review servicing",
    body: "All requested docs now on file. Moving to servicing review with {{lender}}.",
  },
  {
    id: "status-options-presented",
    category: "status",
    label: "Options presented",
    description: "Walked customer through lender shortlist",
    body: "Presented {{N}} lender options to customer. Shortlist: {{lender list}}. Customer to come back with preference by {{date}}.",
  },
  {
    id: "status-customer-chose-lender",
    category: "status",
    label: "Customer chose lender",
    description: "Lender selected, moving to lodgement",
    body: "Customer confirmed proceeding with {{lender}}. Preparing application pack for lodgement on {{target date}}.",
  },

  /* ─── Lender milestones ──────────────────────────────────────── */
  {
    id: "lender-lodged",
    category: "lender",
    label: "Application lodged",
    description: "Submitted to lender, awaiting assessor",
    body: "Application lodged with {{lender}} on {{date}}. Reference: {{lender ref}}. Expected initial response within {{N}} business days.",
  },
  {
    id: "lender-conditional-approval",
    category: "lender",
    label: "Conditional approval received",
    description: "Conditions to satisfy before unconditional",
    body: "Conditional approval received from {{lender}}. Conditions:\n• {{condition 1}}\n• {{condition 2}}\n• {{condition 3}}\nTarget: satisfy by {{date}}.",
  },
  {
    id: "lender-unconditional",
    category: "lender",
    label: "Unconditional approval",
    description: "Loan docs to follow",
    body: "Unconditional approval issued by {{lender}}. Loan documents to be issued by {{date}}. Settlement target: {{settlement date}}.",
  },
  {
    id: "lender-settlement-booked",
    category: "lender",
    label: "Settlement booked",
    description: "Settlement date confirmed with all parties",
    body: "Settlement booked with {{lender}} for {{date}} at {{time}}. Conveyancer: {{conveyancer}}. Funds confirmed with {{lender}} solicitor.",
  },

  /* ─── Customer contact ───────────────────────────────────────── */
  {
    id: "customer-call-summary",
    category: "customer",
    label: "Call summary",
    description: "Summary of a phone call with the customer",
    body: "Spoke with customer at {{time}}. Discussed: {{topics}}. Customer to action: {{action}} by {{date}}.",
  },
  {
    id: "customer-promised-docs",
    category: "customer",
    label: "Customer promised docs",
    description: "Customer committed to providing outstanding docs",
    body: "Customer confirmed they will provide {{doc list}} by {{date}}. Reminder scheduled.",
  },

  /* ─── Advisory / Compliance ──────────────────────────────────── */
  {
    id: "advisory-doc-stale",
    category: "advisory",
    label: "Advisory · stale doc",
    description: "Doc on file but too old for lender requirements",
    body: "{{doc name}} on file but dated {{old date}}, outside lender's {{N}}-day window. Requesting updated version from customer.",
  },
  {
    id: "compliance-best-interests",
    category: "compliance",
    label: "Best Interests Duty assessment",
    description: "RG209 / NCCP record of why this lender suits the customer",
    body: "Best Interests Duty assessment for {{lender}}:\n\n• Customer objectives: {{objectives}}\n• Why {{lender}} suits: {{reasoning}}\n• Alternatives considered: {{alt lenders}}\n• Disclosures made: {{disclosures}}\n\nBroker confidence: {{high/medium/low}}.",
  },
  {
    id: "compliance-privacy-collected",
    category: "compliance",
    label: "Privacy consent recorded",
    description: "Customer consent to credit checks + disclosures",
    body: "Privacy consent collected from customer on {{date}} via {{channel}}. Credit reference checks authorised. Record retained on portal.",
  },
];

export function noteTemplateById(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id);
}

export const CATEGORY_LABEL: Record<NoteTemplateCategory, string> = {
  status: "Status update",
  lender: "Lender milestone",
  customer: "Customer contact",
  advisory: "Advisory",
  compliance: "Compliance",
};

/**
 * Reserved note tags that aren't broker-pickable templates but mark a note
 * created by a particular flow, so the note history (and its Export PDF)
 * shows a category chip for it. Deliberately kept out of NOTE_TEMPLATES so
 * they never appear in the AddNote picker — a note carrying one of these ids
 * still resolves to a readable label via listDealNotesAction.
 */
export const RESERVED_NOTE_LABELS: Record<string, string> = {
  "tracker-comment": "Tracker comment",
};

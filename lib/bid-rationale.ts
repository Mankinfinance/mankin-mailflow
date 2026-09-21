import "server-only";
import { chatComplete } from "@/lib/clients/claude";
import {
  stageMeta,
  type Deal,
} from "@/lib/clients/salestrekker/types";
import { docName } from "@/lib/clients/salestrekker/doc-catalog";

/**
 * Best Interests Duty (BID) rationale drafter.
 *
 * Mortgage brokers in Australia are legally required (NCCPA s158LA) to
 * act in the best interests of their consumer. ASIC's RG 273 sets out
 * what that means: brokers must record the reasoning that links the
 * customer's situation to the chosen credit product, including options
 * considered and rejected.
 *
 * In practice that's a 1-page memo against every deal. Brokers write
 * the same memo over and over from the same shape of information that
 * already lives on the deal: customer category, lender, loan amount,
 * settled-on date, comments. Claude can draft it from that context;
 * the broker then edits the structured sections to add anything the
 * deal record doesn't capture (servicing, comparison rate analysis,
 * customer's stated priorities in their own words) before posting it
 * to the file as a deal note.
 *
 * Operating context:
 *   - Mankin operates as Authorised Credit Representative 102746 under
 *     YBR Aggregation's ACL 390261. YBR is the licensee on record.
 *   - The memo is a DRAFT. The broker reviews, edits, signs off.
 *     Claude never claims the memo is complete or compliant alone.
 *
 * Mock mode (MOCK_CHAT default-true) returns a deterministic template
 * so the UX works without burning API credits.
 */

export interface BidDraftInput {
  deal: Deal;
  brokerShort: string;
}

export interface BidDraft {
  /** The full memo body, plain text, with section headings. */
  memo: string;
  source: "anthropic" | "mock";
}

/* -------------------------------------------------------------------------- */
/* System prompt                                                              */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `You are a compliance writing assistant for Mankin Finance, a small Australian mortgage brokerage in Oran Park, NSW. Mankin operates as Authorised Credit Representative 102746 under YBR Aggregation Services Pty Ltd's Australian Credit Licence 390261.

Your job: draft a Best Interests Duty (BID) rationale memo from the deal context supplied. The broker reviews and signs off. Your draft is a starting point that captures what the deal record actually shows.

LEGAL CONTEXT (do not parrot back, but inform your draft):
- National Consumer Credit Protection Amendment (Mortgage Brokers) Act 2019, s158LA: brokers must act in the best interests of consumers when providing credit assistance.
- ASIC Regulatory Guide 273: the rationale must demonstrate (a) the consumer's objectives, financial situation, and needs, (b) credit products and lenders considered, (c) why the recommended product was selected, (d) the costs, features and risks compared.

VOICE RULES (enforce strictly):
- Plain Australian English. No Americanisms.
- No exclamation marks.
- NEVER use em dashes (Unicode U+2014) anywhere. This includes the character that looks like a long dash. Replace with a hyphen, a full stop, a comma, a colon, a semicolon, or parentheses. Check every line of your output for this character before responding.
- Never the word "happy".
- Use Australian spellings (organise, prioritise, recognise).
- Direct, factual, third person. This is a record memo, not a sales pitch.
- Where the deal record does not show information, write "TBC by broker" or "[broker to confirm]" rather than guessing. The broker reviews and fills these in.

OUTPUT FORMAT (use these exact section headings, in this order):
1. Customer objectives and requirements
2. Financial circumstances summary
3. Lenders and products considered
4. Recommended product and rationale
5. Costs and features compared
6. Risks disclosed to the customer
7. Outstanding items / broker to confirm

Each section is a short paragraph or 2-4 bullet points. The whole memo should fit on one A4 page (roughly 400-600 words). Do not include a preamble or sign-off. Do not include any subject line or markdown formatting.

Output only the memo body, starting with "1. Customer objectives and requirements".`;

/* -------------------------------------------------------------------------- */
/* User prompt builder                                                        */
/* -------------------------------------------------------------------------- */

function buildUserPrompt(input: BidDraftInput): string {
  const { deal, brokerShort } = input;
  const meta = stageMeta(deal.stageId);

  const overdueDocs = deal.overdue.map((id) => docName(deal.customDocs, id));
  const pendingDocs = deal.pending.map((id) => docName(deal.customDocs, id));
  const receivedDocs = deal.received.map((id) => docName(deal.customDocs, id));
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");

  const loanAmountText =
    deal.loanAmount && deal.loanAmount > 0
      ? `$${deal.loanAmount.toLocaleString("en-AU")} AUD`
      : "TBC";

  const applicants =
    deal.applicants.length > 0
      ? deal.applicants.map((a) => a.name).join(", ")
      : deal.name;
  const guarantors =
    deal.guarantors.length > 0
      ? deal.guarantors.map((g) => `${g.name}${g.relationship ? ` (${g.relationship})` : ""}`).join(", ")
      : "None recorded";

  const context = {
    deal: {
      appRef: deal.appRef,
      stage: meta.label,
      mankinStage: deal.mankinStage,
      lender: lenderShort,
      loanAmount: loanAmountText,
      purpose: deal.purpose,
      leadCategory: deal.leadCategory,
      leadSource: deal.leadSource,
      settlementDate: deal.settlement,
      settledOn: deal.settledOn,
    },
    customer: {
      primary: deal.name,
      applicants,
      guarantors,
      email: deal.email,
      phone: deal.phone,
    },
    docs: {
      received: receivedDocs,
      pending: pendingDocs,
      overdue: overdueDocs,
    },
    notes: {
      comments: deal.comments,
      referrer: deal.referrer,
    },
    conveyancer: deal.conveyancer,
    broker: { short: brokerShort },
  };

  return [
    "Draft a Best Interests Duty rationale memo for the deal below.",
    "",
    "Context (JSON):",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "Constraints:",
    `- Cover only what the record actually shows. Mark unknown fields "TBC by broker" rather than inventing.`,
    `- Section 3 (Lenders and products considered): if the record only shows one lender, note that the broker should confirm what alternatives were compared. Suggest 2-3 plausible AU lenders the broker may have considered alongside ${lenderShort || "the chosen lender"} based on the loan purpose (${deal.purpose}) so the broker can either confirm or correct.`,
    `- Section 7 (Outstanding items / broker to confirm): list anything missing from the record that the broker needs to add before this memo is complete (servicing calculation, comparison rate analysis, customer's stated priorities in their own words, fee disclosure conversation).`,
    `- Do not include any sign-off line, signature, or "draft prepared by" footer. The broker adds those.`,
    `- Do not include the words "happy" or em dashes anywhere.`,
    "",
    "Output now:",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Mock fallback                                                              */
/* -------------------------------------------------------------------------- */

function mockDraft(input: BidDraftInput): BidDraft {
  const { deal } = input;
  const lenderShort = deal.lender.replace(" (chosen)", "").replace(" (proposed)", "");
  const loanAmountText =
    deal.loanAmount && deal.loanAmount > 0
      ? `$${deal.loanAmount.toLocaleString("en-AU")}`
      : "TBC";
  const purposeLabel =
    deal.purpose === "purchase"
      ? "an owner-occupied / investment purchase"
      : deal.purpose === "refinance"
        ? "a refinance"
        : "their finance objective (purpose TBC by broker)";

  const memo = `1. Customer objectives and requirements
The customer is seeking ${purposeLabel}. Loan amount sought: ${loanAmountText}. Settlement target: ${deal.settlement || "TBC"}. The customer's specific priorities (rate, features, repayment flexibility, offset, lender preference) need to be confirmed by the broker and added here in the customer's own words.

2. Financial circumstances summary
Applicants: ${deal.applicants.map((a) => a.name).join(", ") || deal.name}.
Guarantors: ${deal.guarantors.map((g) => g.name).join(", ") || "None recorded"}.
Income, liabilities and living expenses to be confirmed against the supplied payslips, bank statements and Notice of Assessment. Servicing surplus calculation: TBC by broker.

3. Lenders and products considered
Recommended lender: ${lenderShort || "[broker to confirm]"}.
The record currently shows one lender. Broker to confirm alternatives compared (e.g. CBA, Westpac, Macquarie, ING) and the reason each was ruled out. Without that comparison the rationale is incomplete.

4. Recommended product and rationale
Product: [broker to confirm specific product code / variant].
Rationale: TBC by broker. The chosen product needs to be matched to the customer's stated priorities from section 1 (e.g. "offset account aligned with customer's preference to park surplus income"; "fixed portion for budget certainty").

5. Costs and features compared
Comparison rate, ongoing fees, upfront fees, break costs and discharge fees: TBC by broker against the lender's Key Facts Sheet. Estimated total cost over the customer's expected loan term should be referenced.

6. Risks disclosed to the customer
The broker has disclosed: interest rate movement risk, the cost of break fees if the customer exits a fixed rate early, the impact of LMI where LVR is above 80%, and the customer's right to seek their own legal advice. Customer acknowledgement to be recorded.

7. Outstanding items / broker to confirm
- Customer's stated priorities in their own words.
- Alternative lenders considered and reasons ruled out.
- Specific product code and variant.
- Servicing calculation summary.
- Comparison rate analysis across the shortlisted lenders.
- Fee disclosure conversation noted (when, how, customer response).
- LMI / LVR position and customer acknowledgement of cost.
${deal.pending.length + deal.overdue.length > 0 ? `\nDocs still outstanding before lodgement (${deal.pending.length + deal.overdue.length}): ${[...deal.pending, ...deal.overdue].map((id) => docName(deal.customDocs, id)).slice(0, 5).join(", ")}.` : ""}`;

  return { memo, source: "mock" };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function draftBidRationale(input: BidDraftInput): Promise<BidDraft> {
  // Short-circuit when no API key — the chatComplete client returns
  // mock anyway, but we want a domain-aware mock here that knows the
  // BID section structure.
  if (process.env.MOCK_CHAT !== "false" || !process.env.ANTHROPIC_API_KEY) {
    return mockDraft(input);
  }

  const result = await chatComplete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const text = result.text.trim();
  if (!text || text.length < 200) {
    // Suspiciously short response — degrade to template so the broker
    // still has structure to edit against.
    return mockDraft(input);
  }

  return { memo: text, source: "anthropic" };
}

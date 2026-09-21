import "server-only";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  LevelFormat,
  PageOrientation,
} from "docx";
import { formatDateAU } from "@/lib/format-date";

/**
 * Annual review document generator. Produces a .docx that matches the
 * Sarmad Al Zahroom template Michael uses today.
 *
 * Two surfaces want this:
 *   1. CX > Anniversaries > [12-month row] > "Generate annual review"
 *      Broker fills the form, downloads the docx, attaches it to the
 *      anniversary email.
 *   2. (Later) Direct standalone generator under /cx/annual-review/new
 *      for ad-hoc reviews outside the anniversary cadence.
 *
 * The document is paginated A4 portrait with 1" margins, Arial 12pt
 * default, branded title block, and the same content structure as the
 * Sarmad template (cover paragraph + Interest Rate Review table +
 * Property Portfolio Summary + Future Needs list).
 */

export interface AnnualReviewInput {
  /** "Sarmad Al Zahroom" or "Sarah & Tom Reilly" */
  customerName: string;
  /** Broker's first name for the cover paragraph + sign-off. */
  brokerShort: string;
  /** Broker direct number. */
  brokerPhone: string;
  /** Review date (ISO yyyy-mm-dd). Defaults to today. */
  reviewDate?: string;

  /** Lender + loan basics. Most come straight from the settlement
   *  record; broker confirms/edits before generating. */
  loan: {
    lender: string;
    accountNumber: string;
    currentBalance: number;
    originalBalance: number;
    propertyType: "Owner Occupied" | "Investment" | "Owner Occupied + Investment";
    loanType: string; // e.g. "Standard Variable", "Basic Variable", "Package"
    interestType: "Variable" | "Fixed" | "Split";
    interestRate: number; // e.g. 5.5 (percent)
    fixedRateExpiry: string; // "N/A" or "01/12/2026"
    interestOnlyExpiry: string; // "N/A" or "01/12/2026"
    repaymentAmount: number; // monthly P&I or IO payment
    offsetAccount: string; // masked, e.g. "XXXX-XX403"
    repaymentAccount: string; // masked
    remainingTerm: string; // "28 Years 11 Months"
    securityProperty: string; // full address
  };

  /** Property valuation comparison. Empty originalAppraisal/value means
   *  the original column is blank (e.g. customer refinanced TO us so
   *  we don't have settlement valuation). */
  property: {
    address: string;
    originalSettlementDate: string; // ISO yyyy-mm-dd
    originalPropertyValue: number;
    currentAppraisalDate: string; // ISO yyyy-mm-dd
    currentPropertyValue: number;
    /** Loan amount at original settlement, used to compute equity. */
    originalLoanAmount: number;
    /** Current loan balance (mirrors loan.currentBalance, kept here for
     *  clarity in the equity calculation). */
    currentLoanBalance: number;
  };

  /** Optional broker notes appended after the table. Useful when the
   *  valuation needs caveats or when there's a structure recommendation
   *  worth calling out in writing. */
  additionalNotes?: string;
}

/**
 * Build the annual review docx as a Node Buffer ready to stream to the
 * browser or save to disk. Caller is responsible for setting the right
 * Content-Type + Content-Disposition headers.
 */
export async function buildAnnualReviewDocx(input: AnnualReviewInput): Promise<Buffer> {
  const reviewDate = input.reviewDate ?? new Date().toISOString().slice(0, 10);
  const dateAU = formatAuDate(reviewDate);

  // Equity calculation: capital growth + principal paid down.
  const capitalGrowth = input.property.currentPropertyValue - input.property.originalPropertyValue;
  const principalPaid = input.property.originalLoanAmount - input.property.currentLoanBalance;
  const grownEquity = capitalGrowth + principalPaid;
  // 80% LVR available equity = (current value * 80%) - current loan
  const lvr80Cap = input.property.currentPropertyValue * 0.8;
  const usableEquity = Math.max(0, lvr80Cap - input.property.currentLoanBalance);

  const doc = new Document({
    creator: "Mankin Finance",
    title: `Annual Review - ${input.customerName}`,
    description: "Annual home loan review prepared by Mankin Finance",
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } }, // 11pt default
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Arial", size: 32, bold: true, color: "1c2566" },
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Arial", size: 26, bold: true, color: "1c2566" },
          paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "future-needs",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width in DXA
              height: 16838, // A4 height in DXA
              orientation: PageOrientation.PORTRAIT,
            },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          /* Brand bar at top */
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [
              new TextRun({ text: "MANKIN FINANCE", bold: true, size: 28, color: "1c2566" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
            children: [
              new TextRun({
                text: "Mortgage broking, looked after for life",
                italics: true,
                size: 20,
                color: "5a6280",
              }),
            ],
          }),

          /* Email-style cover paragraph (broker's intro). Kept short:
             two paragraphs, no marketing fluff. The detail is in the
             tables below. */
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: "A year on, time for your home loan review.",
                bold: true,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun(
                `Below is a snapshot of your current loan with the rate they're charging you, alongside a fresh property valuation and your equity position on ${input.property.address}. The point of the exercise is to make sure you're on a competitive rate and to show you what your equity could be doing for you.`,
              ),
            ],
          }),
          new Paragraph({
            spacing: { after: 360 },
            children: [
              new TextRun(
                `Once you've had a read, reply to this email or call me on ${input.brokerPhone} and we'll lock in a 30-minute call to walk through it.`,
              ),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: "Cheers", bold: false })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: input.brokerShort, bold: true })],
          }),
          new Paragraph({
            spacing: { after: 360 },
            children: [new TextRun({ text: `Mankin Finance · ${input.brokerPhone}`, color: "5a6280" })],
          }),

          /* Title block of the report */
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: input.customerName, bold: true, size: 32, color: "1c2566" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [
              new TextRun({ text: "ANNUAL LOAN REVIEW", bold: true, size: 24, color: "1c2566" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
            children: [new TextRun({ text: dateAU, color: "5a6280" })],
          }),

          /* Interest Rate Review section */
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("INTEREST RATE REVIEW")],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun(
                `Please find below a detailed table of your home loan details with ${input.loan.lender}.`,
              ),
            ],
          }),
          buildLoanDetailsTable(input.loan),

          /* Property Portfolio Summary */
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("PROPERTY PORTFOLIO SUMMARY")],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Address: ", bold: true }),
              new TextRun(input.property.address),
            ],
          }),
          buildValuationTable(input.property),
          new Paragraph({
            spacing: { before: 200, after: 160 },
            children: [
              new TextRun(
                `Capital growth on the property plus the principal you've paid down means you've built ${fmtAud(grownEquity)} of equity since settlement.`,
              ),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun(
                `At 80% LVR that leaves around ${fmtAud(usableEquity)} you could draw against for investment, renovation or paying down higher-cost debt, subject to servicing.`,
              ),
            ],
          }),
          new Paragraph({
            spacing: { after: 320 },
            children: [
              new TextRun({
                text:
                  "Values above come from desktop modelling and can be off if the property has been renovated. Use them as a guide; the attached report is more useful for recent comparable sales than a hard valuation.",
                italics: true,
                color: "5a6280",
              }),
            ],
          }),

          /* Optional broker notes */
          ...(input.additionalNotes && input.additionalNotes.trim().length > 0
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun("BROKER NOTES")],
                }),
                ...input.additionalNotes
                  .split(/\r?\n/)
                  .filter((s) => s.trim().length > 0)
                  .map(
                    (line) =>
                      new Paragraph({
                        spacing: { after: 120 },
                        children: [new TextRun(line)],
                      }),
                  ),
              ]
            : []),

          /* Future needs + objectives */
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("WHAT ELSE WE CAN HELP WITH")],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun(
                "Beyond the annual review, we look after the full finance picture:",
              ),
            ],
          }),
          ...[
            "Buying your next home or investment property",
            "Renovation and construction finance",
            "Business and commercial lending",
            "Car and personal loans",
            "Equity release for education, weddings or family support",
            "Debt consolidation (credit cards, BNPL, personal loans rolled into your home loan)",
          ].map(
            (point) =>
              new Paragraph({
                numbering: { reference: "future-needs", level: 0 },
                spacing: { after: 60 },
                children: [new TextRun(point)],
              }),
          ),

          /* Closing */
          new Paragraph({
            spacing: { before: 360, after: 120 },
            children: [
              new TextRun({
                text: "Next steps",
                bold: true,
                size: 24,
                color: "1c2566",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun(
                `Reply with two or three windows in the next two weeks and we'll lock in a 30-minute call to walk through it. Or call me on ${input.brokerPhone}.`,
              ),
            ],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: "Kind regards,", italics: false })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: input.brokerShort, bold: true })],
          }),
          new Paragraph({
            spacing: { after: 360 },
            children: [
              new TextRun({
                text: `Mankin Finance · ${input.brokerPhone}`,
                color: "5a6280",
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

function buildLoanDetailsTable(loan: AnnualReviewInput["loan"]): Table {
  const rows: Array<[string, string]> = [
    ["Loan Account number", loan.accountNumber],
    ["Current balance", fmtAud(loan.currentBalance)],
    ["Original balance", fmtAud(loan.originalBalance)],
    ["Property type", loan.propertyType],
    ["Loan type", loan.loanType],
    ["Interest type", loan.interestType],
    ["Interest rate", `${loan.interestRate.toFixed(2)}%`],
    ["Fixed rate expiry", loan.fixedRateExpiry || "N/A"],
    ["Interest only expiry", loan.interestOnlyExpiry || "N/A"],
    ["P&I payment", fmtAud(loan.repaymentAmount)],
    ["Offset account attached", loan.offsetAccount || "N/A"],
    ["Repayment account number", loan.repaymentAccount || "N/A"],
    ["Remaining term of loan", loan.remainingTerm],
    ["Security property", loan.securityProperty],
  ];

  return buildTwoColumnTable(rows, 3200, 5680);
}

function buildValuationTable(p: AnnualReviewInput["property"]): Table {
  // Three columns: label / Original Settlement / Current Appraisal
  const labelCol = 2800;
  const dataCol = 3040;
  const tableWidth = labelCol + dataCol * 2;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "C8CCD8" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerFill = "EFEFF7";

  const headerCell = (text: string, width: number) =>
    new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: headerFill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true })],
        }),
      ],
    });
  const dataCell = (text: string, width: number, bold = false) =>
    new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold })],
        }),
      ],
    });

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: [labelCol, dataCol, dataCol],
    rows: [
      new TableRow({
        children: [
          headerCell("", labelCol),
          headerCell("Original Settlement", dataCol),
          headerCell("Current Appraisal", dataCol),
        ],
      }),
      new TableRow({
        children: [
          dataCell("Date", labelCol, true),
          dataCell(formatAuDate(p.originalSettlementDate), dataCol),
          dataCell(formatAuDate(p.currentAppraisalDate), dataCol),
        ],
      }),
      new TableRow({
        children: [
          dataCell("Property Value", labelCol, true),
          dataCell(fmtAud(p.originalPropertyValue), dataCol),
          dataCell(fmtAud(p.currentPropertyValue), dataCol),
        ],
      }),
      new TableRow({
        children: [
          dataCell("Loan amount", labelCol, true),
          dataCell(fmtAud(p.originalLoanAmount), dataCol),
          dataCell(fmtAud(p.currentLoanBalance), dataCol),
        ],
      }),
    ],
  });
}

function buildTwoColumnTable(
  rows: Array<[string, string]>,
  labelWidth: number,
  valueWidth: number,
): Table {
  const tableWidth = labelWidth + valueWidth;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "C8CCD8" };
  const borders = { top: border, bottom: border, left: border, right: border };

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    rows: rows.map(
      ([label, value], idx) =>
        new TableRow({
          children: [
            new TableCell({
              borders,
              width: { size: labelWidth, type: WidthType.DXA },
              shading: {
                fill: idx % 2 === 0 ? "F7F7FB" : "FFFFFF",
                type: ShadingType.CLEAR,
                color: "auto",
              },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: label, bold: true })],
                }),
              ],
            }),
            new TableCell({
              borders,
              width: { size: valueWidth, type: WidthType.DXA },
              shading: {
                fill: idx % 2 === 0 ? "F7F7FB" : "FFFFFF",
                type: ShadingType.CLEAR,
                color: "auto",
              },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun(value)],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                  */
/* -------------------------------------------------------------------------- */

function fmtAud(n: number): string {
  if (!Number.isFinite(n)) return "N/A";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-AU")}`;
}

function formatAuDate(iso: string): string {
  return formatDateAU(iso);
}

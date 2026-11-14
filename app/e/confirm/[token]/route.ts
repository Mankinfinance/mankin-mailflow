import { confirmByToken, findConfirmable } from "@/lib/forms/consent";

/**
 * Double opt-in confirmation.
 *
 * GET only shows a button; POST does the confirming. Mail scanners
 * (Microsoft Safe Links, Gmail's pre-fetch, corporate gateways) open
 * every link in an email, so a GET that confirmed would mark people as
 * confirmed who never saw the email - which is exactly what double
 * opt-in exists to prove didn't happen.
 */

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function page(heading: string, inner: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Mankin Finance</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ee;font-family:Arial,Helvetica,sans-serif;color:#22253a;">
<main style="max-width:420px;margin:24px 16px;background:#ffffff;border-radius:10px;padding:28px 24px;text-align:center;">
<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;color:#0c034b;margin:0 0 10px;">${heading}</h1>
${inner}
</main></body></html>`,
    { status, headers: HEADERS },
  );
}

const P = (text: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#5f636e;">${text}</p>`;

function problem(reason: "invalid" | "expired"): Response {
  return reason === "expired"
    ? page(
        "This link has expired",
        P("Confirmation links last 30 days. Fill in the form again and we'll send a fresh one."),
        410,
      )
    : page(
        "This link doesn't work",
        P("It may have been copied incompletely. Try opening it straight from the email."),
        404,
      );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const found = await findConfirmable(token);
  if ("error" in found) return problem(found.error);
  if (found.submission.consentStatus === "confirmed") {
    return page("You're already confirmed", P("Thanks. There's nothing more to do."));
  }
  return page(
    "Confirm your email",
    `${P("Tap the button to confirm you'd like occasional emails from Mankin Finance. You can unsubscribe from any of them.")}
<form method="post" style="margin:18px 0 0;"><button type="submit" style="font:bold 15px Arial,Helvetica,sans-serif;color:#ffffff;background:#161461;border:0;border-radius:8px;padding:12px 22px;cursor:pointer;">Yes, send me emails</button></form>`,
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const outcome = await confirmByToken(token);
  if (!outcome.ok) return problem(outcome.reason);
  return page(
    "Thanks, you're confirmed",
    P("You'll hear from us now and then. Every email has an unsubscribe link at the bottom."),
  );
}

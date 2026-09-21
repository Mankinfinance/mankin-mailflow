import { NextResponse } from "next/server";
import { repos } from "@/lib/db/repos";
import { submitForm } from "@/lib/forms/submit";

/**
 * Public form submission endpoint.
 *
 * Called from the hosted page and from the embed snippet on the firm's
 * own site, so it answers CORS — an embedded form lives on
 * mankinfinance.com while this runs on the app origin.
 *
 * No session, by design: this is the one endpoint a stranger is supposed
 * to reach. The protections are that a form must be live, the payload is
 * validated against the form's own field list, and nothing here reads or
 * returns anything about existing customers.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const form = await repos().form.get(id);
  if (!form) {
    return NextResponse.json(
      { ok: false, error: "This form no longer exists." },
      { status: 404, headers: CORS },
    );
  }

  let payload: Record<string, string>;
  try {
    payload = (await req.json()) as Record<string, string>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "That submission could not be read." },
      { status: 400, headers: CORS },
    );
  }

  // A hidden field no human fills in. Bots do, and a silent success is
  // a better deterrent than an error they can learn from.
  if (typeof payload.website === "string" && payload.website.trim()) {
    return NextResponse.json({ ok: true, thanks: "Thanks." }, { headers: CORS });
  }

  const {
    name = "",
    email = "",
    phone = "",
    pageId = "",
    ...answers
  } = payload;
  delete (answers as Record<string, unknown>).website;

  const result = await submitForm(form, {
    name,
    email,
    phone,
    answers: answers as Record<string, string>,
    // Unverified — submitForm checks it names a published page
    // that embeds this form before recording it.
    pageId,
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
    headers: CORS,
  });
}

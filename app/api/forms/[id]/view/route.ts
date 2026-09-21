import { NextResponse } from "next/server";
import { repos } from "@/lib/db/repos";

/**
 * Impression counter, so the conversion rate has a denominator.
 *
 * A counter rather than a row per view: the only question asked of this
 * is submissions ÷ views, and a row per page load on a public website is
 * a table that grows forever to answer a division.
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await repos().form.recordView(id);
  } catch (err) {
    // Never let counting break the form that is being counted.
    console.error("[form view] failed to record", err);
  }
  return NextResponse.json({ ok: true }, { headers: CORS });
}

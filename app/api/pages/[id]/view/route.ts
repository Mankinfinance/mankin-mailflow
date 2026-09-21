import { NextResponse } from "next/server";
import { repos } from "@/lib/db/repos";

/** Landing page impression counter. Same shape as the form one. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await repos().landingPage.recordView(id);
  } catch (err) {
    console.error("[page view] failed to record", err);
  }
  return NextResponse.json({ ok: true });
}

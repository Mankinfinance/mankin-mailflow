import { NextResponse } from "next/server";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { MAX_FILE_BYTES, checkUpload } from "@/lib/media/types";

/**
 * Image upload.
 *
 * A route handler rather than a server action because a server action's
 * request body is capped well below 2 MB by default, and raising that
 * cap application-wide to allow one upload screen is the wrong trade.
 *
 * Admin-gated. Anything stored here is served from this origin, so who
 * may add to it is a security question, not a convenience one.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return NextResponse.json(
      { ok: false, error: "Admin access required to upload files." },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "That upload could not be read." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file was attached." },
      { status: 400 },
    );
  }

  /* Check the declared size before reading the body into memory, so an
     oversized upload is refused rather than buffered first. The real
     check is on the decoded bytes below — this one is only to avoid
     doing the work. */
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      {
        ok: false,
        error: `That file is ${mb} MB. The limit is 2 MB — resize it, or export it at a lower quality.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload({ name: file.name, bytes });
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  }

  const altText = String(form.get("altText") ?? "").trim().slice(0, 300);

  const saved = await repos().media.create({
    name: check.name,
    // From the bytes, never from what the client claimed — this value
    // becomes a Content-Type response header.
    contentType: check.contentType,
    size: bytes.length,
    data: Buffer.from(bytes).toString("base64"),
    altText,
    uploadedBy: broker.id,
  });

  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "media.upload",
    meta: {
      fileId: saved.id,
      name: saved.name,
      contentType: saved.contentType,
      size: saved.size,
    },
  });

  return NextResponse.json({ ok: true, file: saved });
}

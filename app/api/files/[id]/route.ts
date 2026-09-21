import { repos } from "@/lib/db/repos";
import { isAllowedImageType } from "@/lib/media/types";

/**
 * Serve an uploaded image.
 *
 * Public and unauthenticated, necessarily: this URL goes inside an
 * email, and the mail client fetching it has no session and never will.
 * A signed URL would not work either — it expires, and the email in
 * someone's inbox does not.
 *
 * What makes that safe is what happens at upload rather than here: only
 * raster images pass, the type is read from the bytes, and the id is a
 * uuid so the library cannot be walked. The content-type check below is
 * a second reading of the same rule, in case a row ever arrives by
 * another route.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = await repos().media.get(id);
  if (!file) return new Response("Not found", { status: 404 });

  /* Refuse to serve anything the upload rules would not accept today.
     Serving an unexpected type from our own origin is the one outcome
     worth failing closed over. */
  if (!isAllowedImageType(file.contentType)) {
    console.error(
      `[media] refusing to serve ${file.id}: content type ${file.contentType}`,
    );
    return new Response("Not found", { status: 404 });
  }

  const bytes = Buffer.from(file.data, "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(bytes.length),
      /* Immutable because the id names these exact bytes — an edit
         uploads a new file. That matters more than usual here: the
         same image is fetched once per reader per open, and without
         this every one of those is a database round trip. */
      "Cache-Control": "public, max-age=31536000, immutable",
      /* Belt and braces. Even with the allow-list above, telling the
         browser not to re-interpret the type costs nothing. */
      "X-Content-Type-Options": "nosniff",
      /* Inline: this is an image in an email, not a download. The name
         is already stripped of anything header-breaking. */
      "Content-Disposition": `inline; filename="${file.name}"`,
    },
  });
}

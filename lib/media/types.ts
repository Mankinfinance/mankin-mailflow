/**
 * What may be uploaded, and what it is served back as.
 *
 * Pure module — no server imports — so the rules that decide whether a
 * file is safe to host are testable without a request.
 *
 * The threat this guards against is not exotic. Anything uploaded here
 * is served from the app's own origin, and its stored content type
 * becomes a response header. Accept `text/html` and you have given
 * anyone who can reach the upload a page on your domain, with your
 * cookies in scope. Accept `image/svg+xml` and you have done the same
 * thing less obviously: SVG is a document format that executes script.
 *
 * So the allow-list is raster images only, the type is decided from the
 * bytes rather than from what the client claimed, and the serve route
 * repeats the check before it answers.
 */

/** Raster formats every mail client renders. No SVG — see above. */
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * 2 MB. Generous for a logo or a header image and mean for anything
 * else, which is the intent: an email that makes someone download a
 * 5 MB photograph on mobile data has already failed.
 *
 * It is also what keeps the bytes-in-Postgres decision reasonable.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Identify a file from its leading bytes.
 *
 * The browser's reported MIME type is a claim by the uploader, and the
 * filename extension is worth even less. These are the actual magic
 * numbers, so a .png that is really an HTML document is refused rather
 * than stored and later served as an image that isn't one.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  const at = (i: number) => bytes[i];

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61
  ) {
    return "image/gif";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export type UploadCheck =
  | { ok: true; contentType: AllowedImageType; name: string }
  | { ok: false; error: string };

/**
 * Decide whether an upload may be stored, and under what name.
 *
 * Every rejection says what to do about it. "Invalid file" tells a
 * broker nothing they can act on.
 */
export function checkUpload(args: {
  name: string;
  bytes: Uint8Array;
}): UploadCheck {
  if (args.bytes.length === 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (args.bytes.length > MAX_FILE_BYTES) {
    const mb = (args.bytes.length / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `That file is ${mb} MB. The limit is 2 MB — resize it, or export it at a lower quality.`,
    };
  }

  const sniffed = sniffImageType(args.bytes);
  if (!sniffed) {
    return {
      ok: false,
      error:
        "That is not a PNG, JPEG, GIF or WebP. SVG is deliberately not accepted — it can carry script.",
    };
  }

  return { ok: true, contentType: sniffed, name: safeFileName(args.name) };
}

/**
 * A filename safe to show and to put in a Content-Disposition header.
 *
 * Only ever used for display and download naming — the URL is the row's
 * uuid — but it still passes through a header, so quotes, control
 * characters and line breaks come out.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "image";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "image";
}

/** Human-readable size, for the gallery. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

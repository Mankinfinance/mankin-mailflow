/**
 * Size limits for customer portal uploads. Shared by the client
 * components and the server actions so the message the customer sees
 * always matches what the server will actually accept.
 *
 * There are two transports, with very different ceilings:
 *
 *  1. Direct — the browser asks for a SharePoint upload session and PUTs
 *     the bytes straight into the Mankin tenant. The file never touches
 *     our function, so the platform's request limits do not apply and we
 *     can honour the full 20 MB. This is the production path.
 *
 *  2. Proxy — the file is posted through a server action, which then
 *     forwards it to SharePoint. Used for local development and any
 *     environment without Graph credentials. Capped by Next's
 *     `serverActions.bodySizeLimit` and, on Vercel, by a hard 4.5 MB
 *     payload limit that no amount of Next config can raise.
 */

/** What the portal promises customers, honoured on the direct path. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Ceiling when the file has to travel through a server action. Sits under
 * the 4 MB `bodySizeLimit` in next.config.ts, which in turn sits under
 * Vercel's 4.5 MB payload limit, leaving room for the rest of the request.
 */
export const MAX_PROXY_UPLOAD_BYTES = 3.5 * 1024 * 1024;

/**
 * Target size for one proxied batch request. The bulk panel packs files
 * up to this and then sends another request, so dropping in ten photos
 * does not become one oversized body that the framework rejects.
 */
export const MAX_BATCH_REQUEST_BYTES = MAX_PROXY_UPLOAD_BYTES;

/**
 * Bytes per PUT when streaming direct to SharePoint. Graph requires every
 * chunk except the last to be a multiple of 320 KiB and recommends 5-10
 * MiB; 5 MiB is exactly 16 × 320 KiB.
 */
export const DIRECT_CHUNK_BYTES = 5 * 1024 * 1024;

/** Most files a customer can queue in one go. */
export const MAX_FILES_PER_BATCH = 20;

/** "20 MB" — for user-facing copy and error messages. */
export function formatLimit(bytes: number = MAX_UPLOAD_BYTES): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** Human-readable size of an actual file, e.g. "5.2 MB" or "812 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Upload type denylist. A customer uploads financial documents freely, but
 * we refuse types that a broker opening them from SharePoint could have
 * execute active content (HTML/SVG/XML → stored XSS) or that are executables
 * used to stage malware in the tenant. This is a denylist, not an allowlist,
 * so a legitimate document (PDF, photo, Office file, text) is never wrongly
 * blocked — only genuinely dangerous types are stopped. Enforced
 * server-side; the file input's `accept` attribute is advisory only.
 */
const BLOCKED_UPLOAD_EXTENSIONS = new Set<string>([
  "html", "htm", "xhtml", "xht", "shtml", "mht", "mhtml",
  "svg", "svgz", "xml", "xsl", "xslt",
  "js", "mjs", "cjs", "jsx", "vbs", "vbe", "wsf", "wsh", "hta", "php", "phtml",
  "exe", "dll", "com", "scr", "msi", "msp", "bat", "cmd", "ps1", "psm1",
  "sh", "bash", "jar", "app", "deb", "rpm", "apk", "gadget", "cpl", "inf",
  "reg", "lnk", "iso", "img",
]);

const BLOCKED_UPLOAD_MIME = new Set<string>([
  "text/html", "application/xhtml+xml", "image/svg+xml",
  "application/xml", "text/xml", "application/xslt+xml",
  "application/javascript", "text/javascript", "application/ecmascript",
  "application/x-msdownload", "application/x-msdos-program",
  "application/x-sh", "application/x-httpd-php", "application/x-executable",
  "application/vnd.microsoft.portable-executable",
]);

/** True when a file is safe to accept (not a scriptable / executable type). */
export function uploadTypeAllowed(filename: string, mime?: string | null): boolean {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase().trim() : "";
  if (ext && BLOCKED_UPLOAD_EXTENSIONS.has(ext)) return false;
  if (mime) {
    const base = mime.toLowerCase().split(";")[0].trim();
    if (BLOCKED_UPLOAD_MIME.has(base)) return false;
  }
  return true;
}

/** Customer-facing message for a rejected upload type. */
export function uploadTypeRejectionMessage(filename: string): string {
  return `"${filename}" can't be uploaded. For security we don't accept web pages, scripts, or programs — please upload a PDF, photo, or document.`;
}

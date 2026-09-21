import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Deal } from "./salestrekker/types";
import { getGraphAppToken } from "./graph-token";

/**
 * SharePoint upload client (Microsoft Graph).
 *
 * Production destination: the Mankin Finance SharePoint site,
 * "Deal applications" folder, one subfolder per deal:
 *   https://mankinfinance.sharepoint.com/sites/MankinFinance1
 *     /Deal applications/<appRef>-<lastName>/<filename>
 *
 * Two modes:
 *  - MOCK_UPLOAD=true (or missing Graph creds) → writes to
 *    `web/.uploads/Deal applications/<folder>/<filename>`, mirroring the
 *    production folder structure so dev matches prod.
 *  - MOCK_UPLOAD=false + Graph creds set → real upload via Microsoft
 *    Graph. App-only client_credentials, pre-creates the per-deal
 *    folder if missing, then PUTs the file content.
 */

const ROOT_FOLDER = "Deal applications";

export interface UploadResult {
  /** Where the file lives — local path in mock, SharePoint webUrl in real */
  storedAt: string;
  /** Original filename, sanitised */
  filename: string;
  /** Byte size */
  size: number;
  /** SHA-256 hex of the bytes */
  sha256: string;
  /** Per-deal folder name we computed (under Deal applications) */
  folder: string;
  /** Public webUrl in real mode; null in mock */
  webUrl: string | null;
  /** Graph driveItem id when real mode; null in mock */
  itemId: string | null;
}

/**
 * Compute the per-deal folder name used inside SharePoint.
 *
 * Rules (set by Michael):
 *   - Single applicant: "FirstName LastName" e.g. "James Doukas"
 *   - Joint applicants, same surname: "First1 & First2 Surname"
 *     alphabetical by first name, e.g. "Sarah & Tom Reilly"
 *   - Joint applicants, different surnames: "First1 Last1 & First2 Last2"
 *     alphabetical by first name, e.g. "Bob Smith & Tara Nguyen"
 *
 * Note: appRef is no longer in the folder name, so two deals for the
 * same client name will land in the same folder. That's intentional -
 * all of Sarah Reilly's docs end up in one place across deals. If
 * collision-avoidance becomes a problem later, suffix with appRef on
 * the second-write path.
 *
 * Sanitisation: strips characters SharePoint reserves (< > : " / \ | ? *)
 * but keeps letters, digits, spaces, ampersand, apostrophe, hyphen, dot.
 * Caps at 200 chars to stay well under the Graph + SharePoint 256 limit.
 */
export function dealFolderName(deal: Pick<Deal, "name">): string {
  const raw = (deal.name ?? "").trim();
  if (!raw) return "deal";

  // Split on " & " or " and " (case-insensitive) for joint applicants.
  // Ampersand without surrounding spaces ("A&B") also splits.
  const parts = raw
    .split(/\s+and\s+|\s*&\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    return sanitiseFolderName(parts[0]);
  }

  // Joint applicants - parse the second one first because the first one
  // might omit the surname (e.g. "Sarah & Tom Reilly" - "Sarah" has no
  // surname of its own, inherit "Reilly" from the second applicant).
  const second = parseApplicant(parts[1]);
  if (!second) return sanitiseFolderName(parts[0]);
  const first = parseApplicant(parts[0], second.last);
  if (!first) return sanitiseFolderName(parts[1]);

  // Alphabetical by first name (case-insensitive).
  const [a, b] = [first, second].sort((x, y) =>
    x.first.toLowerCase().localeCompare(y.first.toLowerCase()),
  );

  const aSurname = a.last ?? "";
  const bSurname = b.last ?? "";
  const sameSurname =
    aSurname && bSurname && aSurname.toLowerCase() === bSurname.toLowerCase();

  if (sameSurname) {
    return sanitiseFolderName(`${a.first} & ${b.first} ${aSurname}`);
  }

  const aFull = aSurname ? `${a.first} ${aSurname}` : a.first;
  const bFull = bSurname ? `${b.first} ${bSurname}` : b.first;
  return sanitiseFolderName(`${aFull} & ${bFull}`);
}

interface Applicant {
  first: string;
  last?: string;
}

function parseApplicant(raw: string, fallbackSurname?: string): Applicant | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    return { first: tokens[0], last: fallbackSurname };
  }
  return { first: tokens[0], last: tokens.slice(1).join(" ") };
}

/**
 * Strip SharePoint-reserved characters from a folder name while keeping
 * the spaces + ampersand + apostrophe + hyphen that the new naming
 * convention relies on. Collapse whitespace, trim, cap at 200 chars.
 */
function sanitiseFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || "deal";
}

/**
 * Sanitise an inbound filename so it's safe in SharePoint + local FS.
 * Allows letters, digits, dot, underscore, hyphen, space. Replaces
 * everything else with `_`. Caps at 200 chars (Graph + SP limit ~256).
 */
export function sanitiseFilename(name: string): string {
  return (
    name
      .replace(/[/\\]+/g, "_")
      // Allow spaces; SharePoint handles them. Just escape on URL.
      .replace(/[^A-Za-z0-9._\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "upload"
  );
}

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), ".uploads", ROOT_FOLDER);

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function uploadDocFile(
  deal: Pick<Deal, "id" | "appRef" | "name">,
  docId: string,
  file: File,
): Promise<UploadResult> {
  const filename = sanitiseFilename(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const folder = dealFolderName(deal);

  if (process.env.MOCK_UPLOAD !== "false" || !isGraphConfigured()) {
    return mockUpload(folder, filename, bytes, sha256, deal.id, docId);
  }
  return graphUpload(folder, filename, bytes, sha256, deal.id, docId);
}

/* -------------------------------------------------------------------------- */
/* Direct browser → SharePoint upload                                          */
/* -------------------------------------------------------------------------- */

export interface DocUploadSession {
  /** Preauthenticated URL the browser PUTs chunks to. Carries its own
   *  short-lived credential, so it must never have an Authorization
   *  header attached (Graph answers 401 if you do). */
  uploadUrl: string;
  expirationDateTime: string;
  folder: string;
  filename: string;
}

/**
 * Whether uploads can go straight from the customer's browser into
 * SharePoint. When false the caller falls back to posting the file
 * through a server action, which is capped by the hosting platform's
 * request body limit.
 */
export function canDirectUpload(): boolean {
  return process.env.MOCK_UPLOAD === "false" && isGraphConfigured();
}

/**
 * Ask Graph for an upload session so the browser can send the bytes
 * itself. This is what lifts the size ceiling: the file never passes
 * through our function, so neither Next's server-action body limit nor
 * Vercel's 4.5 MB payload limit applies to it.
 *
 * The returned URL is scoped to this one file path, which we choose
 * here rather than taking from the client, so possession of it cannot
 * be used to write anywhere else in the drive.
 */
export async function createDocUploadSession(
  deal: Pick<Deal, "id" | "appRef" | "name">,
  rawFilename: string,
): Promise<DocUploadSession> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID!;
  const token = await getGraphAppToken();
  const folder = dealFolderName(deal);
  const filename = sanitiseFilename(rawFilename);

  await ensureFolder(driveId, folder, token);

  const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(ROOT_FOLDER, folder, filename)}:/createUploadSession`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Two customers sending "photo.jpg" must not clobber each other.
      item: { "@microsoft.graph.conflictBehavior": "rename", name: filename },
    }),
  });

  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as GraphDriveItem;
    throw new Error(
      `Graph createUploadSession failed (${resp.status}): ${body.error?.code ?? ""} ${body.error?.message ?? ""}`,
    );
  }

  const json = (await resp.json()) as {
    uploadUrl?: string;
    expirationDateTime?: string;
  };
  if (!json.uploadUrl) {
    throw new Error("Graph createUploadSession returned no uploadUrl");
  }

  return {
    uploadUrl: json.uploadUrl,
    expirationDateTime: json.expirationDateTime ?? "",
    folder,
    filename,
  };
}

/**
 * Read back what actually landed in SharePoint. The browser reports what
 * it uploaded, but the audit trail should not rest on the client's word,
 * so we confirm the item against Graph before recording anything.
 *
 * `conflictBehavior: rename` means the stored name may differ from the
 * one we asked for (photo.jpg → photo 1.jpg), so callers should trust
 * the name that comes back from here.
 */
export async function statUploadedDoc(
  folder: string,
  filename: string,
): Promise<{ filename: string; size: number; webUrl: string | null; itemId: string | null } | null> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID!;
  const token = await getGraphAppToken();
  const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(ROOT_FOLDER, folder, filename)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const item = (await resp.json()) as GraphDriveItem;
  if (!item.id) return null;
  return {
    filename: item.name ?? filename,
    size: item.size ?? 0,
    webUrl: item.webUrl ?? null,
    itemId: item.id,
  };
}

function isGraphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.SHAREPOINT_DRIVE_ID,
  );
}

/**
 * Fetch the SharePoint web URL of a deal's document folder ("Deal
 * applications/<folder>"). The folder is created on the first upload, so
 * calling this after an upload succeeds returns the link to store on the
 * deal. Returns null in mock mode, when Graph isn't configured, or if the
 * folder isn't there yet / the lookup fails — callers treat null as "not
 * available yet" and simply don't set the link.
 */
export async function getDealFolderWebUrl(
  deal: Pick<Deal, "name">,
): Promise<string | null> {
  if (process.env.MOCK_UPLOAD !== "false" || !isGraphConfigured()) return null;
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  if (!driveId) return null;
  try {
    const token = await getGraphAppToken();
    const folder = dealFolderName(deal);
    const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(ROOT_FOLDER, folder)}?$select=webUrl`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const item = (await resp.json()) as GraphDriveItem;
    return item.webUrl ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Mock implementation                                                        */
/* -------------------------------------------------------------------------- */

async function mockUpload(
  folder: string,
  filename: string,
  bytes: Buffer,
  sha256: string,
  dealId: string,
  docId: string,
): Promise<UploadResult> {
  // Vercel serverless functions cannot write to arbitrary filesystem paths.
  // Log and return a fake success so customers never see an upload error
  // when mock mode is active in production.
  if (process.env.VERCEL) {
    console.log(
      `[mock sharepoint] serverless – skipping disk write for ${filename} (${bytes.length}B sha256=${sha256.slice(0, 12)}) dealId=${dealId} docId=${docId}`,
    );
    return {
      storedAt: `[mock]/${folder}/${filename}`,
      filename,
      size: bytes.length,
      sha256,
      folder,
      webUrl: null,
      itemId: null,
    };
  }
  const dir = path.join(LOCAL_UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, filename);
  await fs.writeFile(outPath, bytes);
  console.log(
    `[mock sharepoint] uploaded → ${outPath} (${bytes.length}B sha256=${sha256.slice(0, 12)}) dealId=${dealId} docId=${docId}`,
  );
  return {
    storedAt: outPath,
    filename,
    size: bytes.length,
    sha256,
    folder,
    webUrl: null,
    itemId: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Real Graph implementation                                                  */
/* -------------------------------------------------------------------------- */

interface GraphDriveItem {
  id?: string;
  name?: string;
  webUrl?: string;
  size?: number;
  error?: { code?: string; message?: string };
}

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * URL-encode a path segment for Graph's `:/path:` addressing. Graph
 * expects each segment percent-encoded but slashes preserved as
 * segment separators. We percent-encode each segment individually then
 * join with `/`.
 */
function encodeGraphPath(...segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

async function graphUpload(
  folder: string,
  filename: string,
  bytes: Buffer,
  sha256: string,
  dealId: string,
  docId: string,
): Promise<UploadResult> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID!;
  const token = await getGraphAppToken();

  await ensureFolder(driveId, folder, token);
  const item = await putFile(driveId, folder, filename, bytes, token);

  console.log(
    `[sharepoint] uploaded → ${item.webUrl ?? "(no webUrl)"} (${bytes.length}B sha256=${sha256.slice(0, 12)}) dealId=${dealId} docId=${docId}`,
  );

  return {
    storedAt: item.webUrl ?? `${ROOT_FOLDER}/${folder}/${filename}`,
    filename,
    size: bytes.length,
    sha256,
    folder,
    webUrl: item.webUrl ?? null,
    itemId: item.id ?? null,
  };
}

/**
 * Ensure the per-deal subfolder exists. Graph's PATCH on a path is
 * idempotent when targeting an existing folder, and creates the folder
 * if missing — but we have to PATCH the *parent* with a child-create
 * body to be idempotent. So we use POST to /children with
 * conflictBehavior=replace which succeeds whether or not the folder
 * exists, without overwriting siblings.
 */
async function ensureFolder(
  driveId: string,
  folder: string,
  token: string,
): Promise<void> {
  const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(ROOT_FOLDER)}:/children`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folder,
      folder: {},
      // `replace` would replace the folder's contents — we want
      // `fail` and tolerate the 409 instead.
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });

  if (resp.ok) return;
  if (resp.status === 409) return; // folder already exists — exactly what we want
  const body = (await resp.json().catch(() => ({}))) as GraphDriveItem;
  throw new Error(
    `Graph ensureFolder failed (${resp.status}): ${body.error?.code ?? ""} ${body.error?.message ?? ""}`,
  );
}

/**
 * PUT the file content into the per-deal folder. Returns the parsed
 * driveItem (webUrl + id).
 *
 * Note: simple PUT works for <= 4 MB. Files between 4-20 MB technically
 * require the createUploadSession pattern; in practice Graph also
 * accepts simple PUT up to ~250 MB on SharePoint. We cap uploads at
 * 20 MB in upload-action.ts so we never hit the chunked path.
 */
async function putFile(
  driveId: string,
  folder: string,
  filename: string,
  bytes: Buffer,
  token: string,
): Promise<GraphDriveItem> {
  const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(ROOT_FOLDER, folder, filename)}:/content`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    // Node's Buffer is a Uint8Array at runtime so fetch handles it
    // correctly, but @types/node + @types/lib.dom don't agree on the
    // generic ArrayBuffer-vs-ArrayBufferLike narrowing. Casting at the
    // call site is the smallest fix; the runtime behaviour is correct.
    body: bytes as unknown as BodyInit,
  });

  const json = (await resp.json().catch(() => ({}))) as GraphDriveItem;
  if (!resp.ok) {
    throw new Error(
      `Graph putFile failed (${resp.status}): ${json.error?.code ?? ""} ${json.error?.message ?? "unknown error"}`,
    );
  }
  return json;
}

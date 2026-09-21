/**
 * Browser-side chunked upload to a SharePoint upload session.
 *
 * Runs in the customer's browser, not on the server. The URL comes from
 * `startDirectUpload`, already carries its own credential, and must NOT
 * be sent an Authorization header - Graph answers 401 if you do.
 *
 * Chunks go up strictly in order because Graph rejects out-of-order
 * fragments, and every chunk except the last must be a multiple of
 * 320 KiB. On the final chunk Graph responds 200/201 with the driveItem
 * instead of 202, which is how we know the file is committed.
 */
import { DIRECT_CHUNK_BYTES } from "./portal-upload-limits";

export interface DirectUploadResult {
  ok: boolean;
  error?: string;
}

export async function uploadFileToSession(
  uploadUrl: string,
  file: File,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<DirectUploadResult> {
  const total = file.size;
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + DIRECT_CHUNK_BYTES, total);
    const chunk = file.slice(offset, end);
    const isLast = end >= total;

    let resp: Response;
    try {
      resp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
      });
    } catch {
      // Network dropped mid-transfer. The session survives, but rather
      // than silently resuming we surface it so the customer can retry.
      return { ok: false, error: "The connection dropped during upload. Please try again." };
    }

    if (isLast) {
      if (resp.status === 200 || resp.status === 201) {
        onProgress?.(total, total);
        return { ok: true };
      }
      return {
        ok: false,
        error: `Upload didn't complete (${resp.status}). Please try again.`,
      };
    }

    if (resp.status !== 202) {
      return {
        ok: false,
        error: `Upload interrupted (${resp.status}). Please try again.`,
      };
    }

    offset = end;
    onProgress?.(offset, total);
  }

  return { ok: true };
}

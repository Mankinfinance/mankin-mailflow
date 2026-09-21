"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ImageUp, Trash2 } from "lucide-react";
import { deleteFileAction, setAltTextAction } from "@/app/(mailflow)/marketing/files/actions";
import { formatBytes } from "@/lib/media/types";
import { Eyebrow } from "./MailflowPage";

/**
 * The image library.
 *
 * What a broker needs from this screen is one thing: the snippet to
 * paste into a campaign. So the primary action on every card is "copy
 * the markdown", not "view" or "download" — and it copies
 * `![alt](url)` already filled in, because a URL on its own still
 * leaves them to remember the syntax.
 */

export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  altText: string;
  createdAt: string;
}

export function FileManager({
  files,
  totalBytes,
  baseUrl,
}: {
  files: StoredFile[];
  totalBytes: number;
  baseUrl: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  /* Absolute, for the snippet — that URL is fetched from a mail client
     that knows nothing about this app's host. */
  const publicUrlFor = (id: string) => `${baseUrl}/api/files/${id}`;

  /* Relative, for this page's own thumbnails. Using the absolute one
     here would render a broken image whenever NEXT_PUBLIC_APP_URL does
     not match the host the browser is on — a preview deployment, a
     custom domain, a dev server on another port. The browser is
     already here; it does not need telling where "here" is. */
  const thumbUrlFor = (id: string) => `/api/files/${id}`;

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const resp = await fetch("/api/files/upload", { method: "POST", body });
      const result = (await resp.json()) as
        | { ok: true }
        | { ok: false; error: string };
      if (result.ok) router.refresh();
      else setError(result.error);
    } catch {
      setError("That upload did not reach the server. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function copySnippet(file: StoredFile) {
    const alt = file.altText.trim() || file.name.replace(/\.[^.]+$/, "");
    const snippet = `![${alt}](${publicUrlFor(file.id)})`;
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(file.id);
        window.setTimeout(() => setCopied(null), 1600);
      },
      () => setError("Could not copy — select the snippet and copy it by hand."),
    );
  }

  return (
    <div className="max-w-[860px]">
      {/* ── Upload ── */}
      <div
        className="mb-4 rounded-[10px] border border-dashed px-5 py-5 text-center"
        style={{ borderColor: "var(--color-hairline)", backgroundColor: "var(--color-paper)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <ImageUp size={20} strokeWidth={1.5} className="mx-auto mb-2 text-ink-mute" />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="mf-quiet rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "#161461" }}
        >
          {uploading ? "Uploading…" : "Choose an image"}
        </button>
        <p className="mt-2 text-[11.5px] text-ink-mute">or drop one here</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
          PNG, JPEG, GIF or WebP, up to 2 MB. SVG is not accepted — it can
          carry script, and mail clients block it anyway.
        </p>
        {error && (
          <p className="mt-2 text-[12px] font-semibold text-danger">{error}</p>
        )}
      </div>

      {files.length === 0 ? (
        <p className="py-10 text-center text-[12.5px] text-ink-mute">
          Nothing uploaded yet. An image here can be dropped into any campaign
          body.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <Eyebrow>
              {files.length} {files.length === 1 ? "image" : "images"}
            </Eyebrow>
            <span className="text-[11px] text-ink-faint">
              {formatBytes(totalBytes)} stored
            </span>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex flex-col overflow-hidden rounded-[10px] border border-hairline bg-surface"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div
                  className="flex h-[130px] items-center justify-center overflow-hidden"
                  style={{ backgroundColor: "var(--color-paper-warm)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrlFor(file.id)}
                    alt={file.altText || file.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>

                <div className="flex flex-1 flex-col px-3 py-2.5">
                  <p className="truncate text-[12px] font-semibold text-ink">
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-ink-faint">
                    {formatBytes(file.size)} ·{" "}
                    {file.contentType.replace("image/", "").toUpperCase()}
                  </p>

                  <input
                    defaultValue={file.altText}
                    placeholder="Alt text — what a blocked image should say"
                    disabled={pending}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value === file.altText) return;
                      startTransition(async () => {
                        await setAltTextAction(file.id, value);
                        router.refresh();
                      });
                    }}
                    className="mt-2 h-[28px] w-full rounded-md border border-hairline bg-paper px-2 text-[11px] text-ink placeholder:text-ink-faint"
                  />

                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => copySnippet(file)}
                      className="mf-quiet flex h-[28px] flex-1 items-center justify-center gap-1 rounded-md text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: copied === file.id ? "#2b6e4f" : "#161461" }}
                    >
                      {copied === file.id ? (
                        <>
                          <Check size={11} strokeWidth={2.5} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={11} strokeWidth={2} /> Copy snippet
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Delete ${file.name}`}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete "${file.name}"? Any campaign already sent that used it will show a broken image from now on.`,
                          )
                        ) {
                          return;
                        }
                        startTransition(async () => {
                          await deleteFileAction(file.id);
                          router.refresh();
                        });
                      }}
                      className="mf-quiet flex h-[28px] w-[28px] items-center justify-center rounded-md border border-hairline text-ink-mute transition-colors hover:bg-paper-warm disabled:opacity-50"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

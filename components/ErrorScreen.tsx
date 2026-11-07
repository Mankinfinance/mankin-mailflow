"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * What a page shows when it fails on the server. Next's default was a
 * black "This page couldn't load" with a bare number; this one keeps
 * Mailflow's look, says what usually fixes it, and still shows the
 * number, which matches the line in Vercel's logs for that failure.
 *
 * Plain styles rather than Tailwind classes, because global-error
 * renders without the app's layout or its stylesheet.
 */
export function ErrorScreen({
  digest,
  reset,
  fullPage = false,
}: {
  digest?: string;
  reset: () => void;
  fullPage?: boolean;
}) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <main
      style={{
        minHeight: fullPage ? "100vh" : "100%",
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f4ee",
        color: "#22253a",
        font: '15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif',
        padding: "32px 24px",
      }}
    >
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h1
          style={{
            font: '500 22px/1.25 Georgia, "Times New Roman", serif',
            color: "#0c034b",
            margin: "0 0 8px",
          }}
        >
          This page didn&apos;t load
        </h1>
        <p style={{ margin: "0 0 20px", color: "#5f636e" }}>
          Mailflow hit a problem on its side. Try again. If it keeps happening,
          open Settings and press <strong>Set up the tables</strong>, which
          fixes this after most updates, then <strong>Test connections</strong>.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={retry}
            style={{
              font: "600 14px system-ui, sans-serif",
              color: "#fff",
              background: "#161461",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* A plain link, not next/link: a full load gets a fresh page
              even when the client-side router is what broke. */}
          <a
            href="/marketing/settings#database"
            style={{
              font: "600 14px system-ui, sans-serif",
              color: "#161461",
              background: "#fff",
              border: "1px solid #d9d5cc",
              borderRadius: 8,
              padding: "9px 17px",
              textDecoration: "none",
            }}
          >
            Open Settings
          </a>
        </div>
        {digest && (
          <p style={{ margin: "24px 0 0", font: "12px/1.5 ui-monospace, Menlo, monospace", color: "#8a8d96" }}>
            Error {digest}
          </p>
        )}
      </div>
    </main>
  );
}

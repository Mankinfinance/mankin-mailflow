"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/* The last resort, when the root layout itself fails. It replaces that
   layout, so it brings its own <html> and <body>. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-AU">
      <body style={{ margin: 0 }}>
        <ErrorScreen digest={error.digest} reset={reset} fullPage />
      </body>
    </html>
  );
}

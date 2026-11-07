"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/* Failures above the Mailflow screens: its layout, sign-in, public pages. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} reset={reset} fullPage />;
}

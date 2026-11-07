"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/* Any Mailflow screen that fails on the server lands here, inside the
   Mailflow shell, rather than on Next's bare error page. */
export default function MailflowError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} reset={reset} />;
}

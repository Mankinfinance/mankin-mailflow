"use client";

import * as React from "react";

/**
 * Counts one page view.
 *
 * A client beacon rather than counting in the server component: with
 * force-dynamic every render would count, including bot fetches and the
 * broker's own preview refreshes, which would quietly halve every
 * conversion rate on the page.
 */
export function PageViewBeacon({ pageId }: { pageId: string }) {
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pages/${pageId}/view`, {
      method: "POST",
      signal: controller.signal,
    }).catch(() => {
      /* Counting must never break the page. */
    });
    return () => controller.abort();
  }, [pageId]);

  return null;
}

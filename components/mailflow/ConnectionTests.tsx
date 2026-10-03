"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { ConnectionResult, TestStatus } from "@/lib/setup/connection-tests";
import { testConnectionsAction } from "@/app/(mailflow)/marketing/settings/actions";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * One button that calls every outside service Mailflow depends on and
 * says, per service, whether it answered and what to do if not. Nothing
 * runs until it is pressed: a Microsoft sign-in and an Anthropic lookup
 * on every page load would be waste.
 */

const DOT: Record<TestStatus, string> = {
  pass: "bg-ok",
  warn: "bg-warn",
  fail: "bg-danger",
  skip: "bg-ink-faint",
};

const WORD: Record<TestStatus, string> = {
  pass: "Working",
  warn: "Worth fixing",
  fail: "Not working",
  skip: "Skipped",
};

export function ConnectionTests() {
  const [pending, startTransition] = React.useTransition();
  const [results, setResults] = React.useState<ConnectionResult[] | null>(null);
  const [ranAt, setRanAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await testConnectionsAction();
      if (r.ok) {
        setResults(r.results);
        setRanAt(r.ranAt);
      } else {
        setError(r.error);
      }
    });
  }

  const failing = results?.filter((r) => r.status === "fail").length ?? 0;
  const warning = results?.filter((r) => r.status === "warn").length ?? 0;

  return (
    <Card className="mb-3.5 max-w-[640px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Connections</Eyebrow>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            Calls the database, Microsoft 365, Anthropic and your link
            address for real. Sends no email and shows no secrets.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="mf-quiet h-[30px] shrink-0 rounded-md bg-brand px-3 text-[12px] font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {pending ? "Testing…" : results ? "Test again" : "Test connections"}
        </button>
      </div>

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      {results && (
        <>
          <p className="mt-3 text-[12px] font-semibold text-ink" role="status">
            {failing === 0 && warning === 0
              ? "Everything is working."
              : [
                  failing > 0 && `${failing} not working`,
                  warning > 0 && `${warning} worth fixing`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
            {ranAt && (
              <span className="ml-1.5 font-normal text-ink-faint">
                {new Date(ranAt).toLocaleTimeString("en-AU", {
                  timeZone: "Australia/Sydney",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
          <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
            {results.map((r) => (
              <li key={r.key} className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[r.status])} />
                  <span className="text-[12.5px] font-semibold text-ink">{r.label}</span>
                  <span className="text-[11px] text-ink-mute">{WORD[r.status]}</span>
                </div>
                <p className="mt-1 pl-3.5 text-[12px] leading-relaxed text-ink-soft">{r.detail}</p>
                {r.fix && (
                  <p className="mt-1 pl-3.5 text-[11.5px] leading-relaxed text-ink-mute">
                    <span className="font-semibold text-ink-soft">Fix: </span>
                    {r.fix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

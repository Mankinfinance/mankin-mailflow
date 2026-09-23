"use client";

import * as React from "react";
import { CircleAlert, Database, Check } from "lucide-react";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * Where the data lives, and the button that sets it up.
 *
 * Mailflow runs without a database — the repos fall back to in-memory
 * maps — which is a good property for a first look and a terrible one
 * to discover by accident three weeks in, when a segment somebody
 * built has quietly gone. So the state is stated plainly at the top of
 * Settings rather than left to be inferred.
 *
 * The migrate button exists because the alternative is a broker
 * running a CLI command. Every migration is checked into the repo
 * before it ships; the only missing step was somebody executing them.
 */

export function DatabasePanel({
  connected,
  usingPoolerForMigrations,
}: {
  /** Whether DATABASE_URL is set on this deployment. */
  connected: boolean;
  /** True when migrations would run over the pooler, which is fragile. */
  usingPoolerForMigrations: boolean;
}) {
  const [result, setResult] = React.useState<
    { ok: true; message: string } | { ok: false; error: string } | null
  >(null);
  const [pending, setPending] = React.useState(false);

  async function migrateNow() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/migrate", { method: "POST" });
      const body = await response.json();
      setResult(
        body.ok
          ? { ok: true, message: body.message }
          : { ok: false, error: body.error ?? "That didn't work." },
      );
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mb-3.5">
      <div className="flex items-center gap-1.5">
        <Database size={14} strokeWidth={1.7} className="text-brand" />
        <Eyebrow>Where the data lives</Eyebrow>
      </div>

      {!connected ? (
        <>
          <p className="mt-2 max-w-[620px] text-[12.5px] leading-relaxed text-ink-soft">
            <strong className="font-semibold">
              Nothing you create here is being kept.
            </strong>{" "}
            No database is connected, so Mailflow is running on in-memory
            storage: campaigns, contacts, tags, segments and survey answers
            all reset on the next deploy.
          </p>
          <p className="mt-2 max-w-[620px] text-[12px] leading-relaxed text-ink-mute">
            Fine for looking around. Not somewhere to build a real campaign.
            Add <code className="mono rounded bg-paper-warm px-1 py-px text-[11px]">DATABASE_URL</code>{" "}
            in Vercel, redeploy, then come back here and set the tables up.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-[620px] text-[12.5px] leading-relaxed text-ink-soft">
            A database is connected. If Mailflow has just been deployed with
            new features, its tables may not exist yet — setting them up is
            safe to run at any time, and does nothing if there is nothing to
            do.
          </p>

          {usingPoolerForMigrations && (
            <div
              className="mt-3 flex gap-2 rounded-md border px-3 py-2.5"
              style={{ backgroundColor: "#f3eee4", borderColor: "#e5d3ab" }}
            >
              <CircleAlert
                size={13}
                strokeWidth={1.8}
                className="mt-px shrink-0"
                style={{ color: "#8a6a22" }}
              />
              <p className="text-[11.5px] leading-relaxed text-ink-soft">
                This will run over the connection pooler. It applies
                everything in one transaction, so it either all works or none
                of it does — but a pooler is tuned for short queries, and a
                first run applying twenty-odd files can hit its timeout.
                Setting{" "}
                <code className="mono text-[11px]">MIGRATE_DATABASE_URL</code>{" "}
                to Supabase&apos;s direct connection avoids that. Optional:
                try without it first, and only add it if this times out.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={migrateNow}
            disabled={pending}
            className="mf-quiet mt-3 h-[34px] rounded-md px-3.5 text-[12.5px] font-bold transition-opacity disabled:opacity-60"
            style={{ backgroundColor: "#161461", color: "#ffffff" }}
          >
            {pending ? "Setting up…" : "Set up the tables"}
          </button>
        </>
      )}

      {result && (
        <div
          className="mt-3 flex gap-2 rounded-md border px-3 py-2.5"
          style={
            result.ok
              ? { backgroundColor: "#eef5f0", borderColor: "#cbe0d4" }
              : { backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }
          }
        >
          {result.ok ? (
            <Check size={13} strokeWidth={2.2} className="mt-px shrink-0" style={{ color: "#2f6f4a" }} />
          ) : (
            <CircleAlert size={13} strokeWidth={1.8} className="mt-px shrink-0" style={{ color: "#8a4b48" }} />
          )}
          <p className="text-[11.5px] leading-relaxed text-ink-soft">
            {result.ok ? result.message : result.error}
          </p>
        </div>
      )}
    </Card>
  );
}

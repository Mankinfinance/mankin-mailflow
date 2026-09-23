"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, Database, Check, ArrowRight } from "lucide-react";
import { Card, Eyebrow } from "./MailflowPage";
import type { DatabaseConfig } from "@/lib/db/state";

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
 *
 * The build line at the bottom is not decoration. This panel is
 * deployed code, so "I can't see the button" has two very different
 * causes — the deployment predates the panel, or the environment
 * variable isn't reaching it — and a visible commit tells them apart
 * without anyone guessing.
 */

export function DatabasePanel({
  config,
  detailHref,
  onMigrated,
}: {
  config: DatabaseConfig;
  /** When set, a link through to the fuller database page. */
  detailHref?: string;
  /** Called after a successful run, so a page can refresh its probe. */
  onMigrated?: () => void;
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
      if (body.ok) {
        setResult({ ok: true, message: body.message });
        onMigrated?.();
      } else {
        setResult({ ok: false, error: body.error ?? "That didn't work." });
      }
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Database size={14} strokeWidth={1.7} className="text-brand" />
          <Eyebrow>Where the data lives</Eyebrow>
        </div>
        {detailHref && (
          <Link
            href={detailHref}
            className="flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
          >
            Details
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        )}
      </div>

      {!config.hasUrl ? (
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
            Add{" "}
            <code className="mono rounded bg-paper-warm px-1 py-px text-[11px]">
              DATABASE_URL
            </code>{" "}
            in Vercel, redeploy, then come back here and set the tables up.
          </p>
        </>
      ) : config.forcedMock ? (
        /* The trap worth naming: a connection string is present, so
           everything looks configured, but MOCK_DB=true overrides it
           and every write still goes to a Map. */
        <>
          <p className="mt-2 max-w-[620px] text-[12.5px] leading-relaxed text-ink-soft">
            <strong className="font-semibold">
              A database is connected, but nothing is being written to it.
            </strong>{" "}
            <code className="mono rounded bg-paper-warm px-1 py-px text-[11px]">
              MOCK_DB
            </code>{" "}
            is set to{" "}
            <code className="mono rounded bg-paper-warm px-1 py-px text-[11px]">
              true
            </code>
            , which forces in-memory storage regardless of the connection
            string.
          </p>
          <p className="mt-2 max-w-[620px] text-[12px] leading-relaxed text-ink-mute">
            Delete that variable in Vercel (or set it to{" "}
            <code className="mono text-[11px]">false</code>) and redeploy.
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

          {config.migrationFilesShipped === 0 && (
            <Notice tone="warn">
              This build shipped no migration files, so setting the tables up
              would report success having done nothing. That is a build
              problem rather than a database one — the{" "}
              <code className="mono text-[11px]">drizzle/</code> folder was
              not traced into the function.
            </Notice>
          )}

          {config.usingPoolerForMigrations && (
            <Notice tone="warn">
              This will run over the connection pooler. It applies everything
              in one transaction, so it either all works or none of it does —
              but a pooler is tuned for short queries, and a first run
              applying {config.migrationFilesShipped} files can hit its
              timeout. Setting{" "}
              <code className="mono text-[11px]">MIGRATE_DATABASE_URL</code> to
              Supabase&apos;s direct connection avoids that. Optional: try
              without it first, and only add it if this times out.
            </Notice>
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
        <Notice tone={result.ok ? "good" : "bad"}>
          {result.ok ? result.message : result.error}
        </Notice>
      )}

      <p className="mt-3 border-t border-hairline pt-2 text-[10.5px] text-ink-faint">
        {config.commit ? `Build ${config.commit}` : "Build unknown"}
        {config.deployEnv ? ` · ${config.deployEnv}` : ""} ·{" "}
        {config.migrationFilesShipped} migration
        {config.migrationFilesShipped === 1 ? "" : "s"} shipped ·{" "}
        {config.tablesExpected} tables in the schema
      </p>
    </Card>
  );
}

/**
 * The three states this panel reports in, each carrying an icon and a
 * label as well as its colour — the colour alone is never the message.
 */
function Notice({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const skin = {
    good: { bg: "#eef5f0", border: "#cbe0d4", icon: "#2f6f4a" },
    warn: { bg: "#f3eee4", border: "#e5d3ab", icon: "#8a6a22" },
    bad: { bg: "#fbf0ef", border: "#eccfcd", icon: "#8a4b48" },
  }[tone];

  return (
    <div
      className="mt-3 flex gap-2 rounded-md border px-3 py-2.5"
      style={{ backgroundColor: skin.bg, borderColor: skin.border }}
    >
      {tone === "good" ? (
        <Check
          size={13}
          strokeWidth={2.2}
          className="mt-px shrink-0"
          style={{ color: skin.icon }}
        />
      ) : (
        <CircleAlert
          size={13}
          strokeWidth={1.8}
          className="mt-px shrink-0"
          style={{ color: skin.icon }}
        />
      )}
      <p className="text-[11.5px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

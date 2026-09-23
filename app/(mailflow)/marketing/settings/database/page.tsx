import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { DatabasePanel } from "@/components/mailflow/DatabasePanel";
import { currentBroker } from "@/lib/auth/current-broker";
import { databaseConfig, probeDatabase } from "@/lib/db/state";

export const metadata = { title: "Database · Mailflow" };

/**
 * The database, at a fixed URL.
 *
 * The compact panel at the top of Settings answers "is this being
 * kept". This page answers the next three questions — which build am I
 * looking at, can it actually reach the database, and which tables are
 * there — and it does so at an address that can be typed rather than
 * found. That matters more than it sounds: when the panel is missing
 * because a deployment predates it, a 404 here says so unambiguously,
 * where hunting for a button on a long settings page says nothing at
 * all.
 *
 * It opens a connection on every load, deliberately. A cached answer to
 * "is the database reachable" is worth nothing.
 */
export default async function DatabasePage() {
  const broker = await currentBroker();
  const config = databaseConfig();
  const probe = config.hasUrl
    ? await probeDatabase()
    : null;

  return (
    <>
      <MailflowNav active="settings" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar
          broker={{ name: broker.name, initials: broker.initials }}
        />
        <MailflowContent>
          <Link
            href="/marketing/settings"
            className="mb-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-mute hover:text-brand"
          >
            <ArrowLeft size={12} strokeWidth={2} />
            Settings
          </Link>

          <PageTitle
            title="Database"
            context={
              config.persisting
                ? "Campaigns, contacts, segments and survey answers are written to Postgres."
                : "Mailflow is running on in-memory storage."
            }
          />

          <DatabasePanel config={config} />

          {probe && (
            <Card className="mb-3.5">
              <Eyebrow>Connection</Eyebrow>
              {probe.reachable ? (
                <>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
                    Reached the database and read its table list.
                  </p>
                  <TableProgress
                    present={probe.tablesPresent.length}
                    total={config.tablesExpected}
                  />
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
                    <Row
                      label="Migrations recorded"
                      value={`${probe.migrationsRecorded} of ${config.migrationFilesShipped} shipped`}
                    />
                    <Row
                      label="Last applied"
                      value={
                        probe.lastMigrationAt
                          ? probe.lastMigrationAt.toLocaleString("en-AU", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Never"
                      }
                    />
                  </dl>

                  {probe.tablesMissing.length > 0 && (
                    <div className="mt-3.5">
                      <Eyebrow>
                        Missing ({probe.tablesMissing.length})
                      </Eyebrow>
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-mute">
                        Setting the tables up creates these. Until then,
                        anything that reads them falls back to in-memory
                        storage.
                      </p>
                      <ul className="mono mt-2 flex flex-wrap gap-1.5">
                        {probe.tablesMissing.map((t) => (
                          <li
                            key={t}
                            className="rounded bg-paper-warm px-1.5 py-0.5 text-[10.5px] text-ink-soft"
                          >
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
                    <strong className="font-semibold">
                      Could not reach the database.
                    </strong>{" "}
                    A connection string is set, but opening a connection
                    with it failed.
                  </p>
                  <p className="mono mt-2 rounded bg-paper-warm px-2 py-1.5 text-[11px] leading-relaxed text-ink-soft">
                    {probe.error}
                  </p>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-mute">
                    Usually the password, the host, or Supabase having
                    paused the project. Nothing above contains any part of
                    the connection string.
                  </p>
                </>
              )}
            </Card>
          )}
        </MailflowContent>
      </div>
    </>
  );
}

/**
 * How much of the schema exists, as a proportion — because the count on
 * its own ("31 tables") reads as fine right up until you learn there
 * should be 39.
 */
function TableProgress({
  present,
  total,
}: {
  present: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.round((present / total) * 100);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-ink-soft">Tables present</span>
        <span className="text-[12px] font-semibold text-ink">
          {present} of {total}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "#e8e3d8" }}
        role="img"
        aria-label={`${present} of ${total} tables present`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: "#161461" }}
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hairline py-1">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

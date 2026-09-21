"use client";

import * as React from "react";
import { Ban, Landmark, Mail, Search, Tag as TagIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { filterSubscribers, type Subscriber } from "@/lib/campaigns/subscribers";
import type { ActivityEvent } from "@/lib/campaigns/subscribers";
import { Eyebrow } from "./MailflowPage";

/**
 * Screen 2 — the contact list, and on selection the person's loan
 * context.
 *
 * That context is the whole argument for running this in-house. An
 * external platform knows an address and a tag; this knows the lender,
 * the balance and who wrote the loan, which is what makes "who should I
 * be talking to" answerable from the same screen.
 */

const PAGE_SIZE = 25;

export interface SubscriberTableProps {
  subscribers: Subscriber[];
  brokerNames: Record<string, string>;
  stageNames: Record<string, string>;
  /** Activity per contact, keyed by email. */
  activity: Record<string, ActivityEvent[]>;
  /** Tags per contact, keyed by email. */
  tags: Record<string, string[]>;
  /** Every tag in use, with how many contacts carry it. */
  allTags: Array<{ tag: string; count: number }>;
  onSuppress: (emails: string[]) => Promise<void>;
  onTag: (emails: string[], tag: string) => Promise<void>;
  onUntag: (emails: string[], tag: string) => Promise<void>;
}

export function SubscriberTable({
  subscribers,
  brokerNames,
  stageNames,
  activity,
  tags,
  allTags,
  onSuppress,
  onTag,
  onUntag,
}: SubscriberTableProps) {
  const [search, setSearch] = React.useState("");
  const [source, setSource] = React.useState<"all" | "back-book" | "pipeline">("all");
  const [status, setStatus] = React.useState<"all" | "active" | "unsubscribed" | "bounced">("all");
  const [tag, setTag] = React.useState<string>("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [openEmail, setOpenEmail] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [pending, startTransition] = React.useTransition();

  const filtered = React.useMemo(
    () =>
      filterSubscribers(subscribers, {
        search,
        source,
        status,
        tag,
        tagsByEmail: tags,
      }),
    [subscribers, search, source, status, tag, tags],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const open = openEmail
    ? subscribers.find((s) => s.email === openEmail) ?? null
    : null;

  /* Changing a filter returns you to page 1 — otherwise a narrower
     filter can strand you on a page that no longer exists. Done in the
     setters rather than an effect so there is no render-then-correct. */
  function changeSearch(value: string) {
    setSearch(value);
    setPage(0);
  }
  function changeSource(value: typeof source) {
    setSource(value);
    setPage(0);
  }
  function changeStatus(value: typeof status) {
    setStatus(value);
    setPage(0);
  }
  function changeTag(value: string) {
    setTag(value);
    setPage(0);
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 gap-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Filters ── */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={13}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute"
            />
            <input
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              placeholder="Search name or email"
              className="h-8 w-full rounded-md border border-hairline bg-surface pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-faint"
            />
          </div>
          <Select
            value={source}
            onChange={(v) => changeSource(v as typeof source)}
            options={[
              ["all", "All groups"],
              ["back-book", "Back-book"],
              ["pipeline", "Live pipeline"],
            ]}
          />
          <Select
            value={status}
            onChange={(v) => changeStatus(v as typeof status)}
            options={[
              ["all", "All statuses"],
              ["active", "Active"],
              ["unsubscribed", "Unsubscribed"],
              ["bounced", "Bounced"],
            ]}
          />
          {allTags.length > 0 && (
            <Select
              value={tag}
              onChange={changeTag}
              options={[
                ["all", "Any tag"],
                ...allTags.map(
                  (t) => [t.tag, `${t.tag} (${t.count})`] as [string, string],
                ),
              ]}
            />
          )}
        </div>

        {/* ── Bulk selection ── */}
        {selected.size > 0 && (
          <div
            className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
            style={{ backgroundColor: "#eaeefe", borderColor: "#cfd7f5" }}
          >
            <span className="text-[12px] font-semibold text-brand">
              {selected.size} selected
            </span>
            <span className="flex-1" />
            <BulkAction icon={Mail} label="Start a campaign" disabled />
            <BulkAction
              icon={TagIcon}
              label="Tag"
              disabled={pending}
              onClick={() => {
                const entered = window.prompt(
                  `Tag ${selected.size} ${selected.size === 1 ? "contact" : "contacts"} with:`,
                  "",
                );
                const label = entered?.trim();
                if (!label) return;
                const emails = [...selected];
                startTransition(async () => {
                  await onTag(emails, label);
                  setSelected(new Set());
                });
              }}
            />
            <BulkAction
              icon={Ban}
              label="Do not market"
              tone="#8a4b48"
              disabled={pending}
              onClick={() => {
                const emails = [...selected];
                if (
                  !window.confirm(
                    `Add ${emails.length} ${emails.length === 1 ? "address" : "addresses"} to the do-not-market register? They will be excluded from every future send.`,
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  await onSuppress(emails);
                  setSelected(new Set());
                });
              }}
            />
          </div>
        )}

        {/* ── Table ── */}
        <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-hairline bg-surface">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                <Th width="34px">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.email))}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of rows) {
                          if (e.target.checked) next.add(r.email);
                          else next.delete(r.email);
                        }
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5"
                  />
                </Th>
                <Th>Name</Th>
                <Th>Source</Th>
                <Th>Owner</Th>
                <Th align="right">Client since</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.email}
                  onClick={() => setOpenEmail(s.email)}
                  className="mf-quiet cursor-pointer border-t transition-colors hover:bg-paper-warm"
                  style={{
                    borderColor: "var(--color-hairline-softer)",
                    backgroundColor:
                      openEmail === s.email || selected.has(s.email)
                        ? "#f6f8ff"
                        : undefined,
                  }}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.name}`}
                      checked={selected.has(s.email)}
                      onChange={() => toggle(s.email)}
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block truncate text-[12px] font-semibold text-ink">
                      {s.name}
                    </span>
                    <span className="mono block truncate text-[11px] text-ink-mute">
                      {s.email}
                    </span>
                    {(tags[s.email]?.length ?? 0) > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {tags[s.email].map((t) => (
                          <span
                            key={t}
                            className="rounded-full px-1.5 py-px text-[9.5px] font-semibold"
                            style={{ backgroundColor: "#eaeefe", color: "#3c4270" }}
                          >
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <SourcePill source={s.source} />
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-soft">
                    {brokerNames[s.brokerId] ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink-mute">
                    {s.since
                      ? new Date(s.since).toLocaleDateString("en-AU", {
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <SubscriberStatusPill status={s.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-[12.5px] text-ink-mute">
                    Nobody matches that.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-ink-mute">
          <span>
            {filtered.length === 0
              ? "No contacts"
              : `Showing ${page * PAGE_SIZE + 1}–${Math.min(
                  (page + 1) * PAGE_SIZE,
                  filtered.length,
                )} of ${filtered.length}`}
          </span>
          {pageCount > 1 && (
            <span className="flex items-center gap-1.5">
              <PageButton disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </PageButton>
              <span className="tabular-nums">
                {page + 1} of {pageCount}
              </span>
              <PageButton
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </PageButton>
            </span>
          )}
        </div>
      </div>

      {open && (
        <DetailPanel
          subscriber={open}
          brokerName={brokerNames[open.brokerId] ?? "Unassigned"}
          stageName={open.loan.stageId ? stageNames[open.loan.stageId] : null}
          events={activity[open.email] ?? []}
          tags={tags[open.email] ?? []}
          onAddTag={(t) => onTag([open.email], t)}
          onRemoveTag={(t) => onUntag([open.email], t)}
          onClose={() => setOpenEmail(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DetailPanel({
  subscriber,
  brokerName,
  stageName,
  events,
  tags,
  onAddTag,
  onRemoveTag,
  onClose,
}: {
  subscriber: Subscriber;
  brokerName: string;
  stageName: string | null;
  events: ActivityEvent[];
  tags: string[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  onClose: () => void;
}) {
  const [tagPending, startTagTransition] = React.useTransition();
  const money = (v: number | null) =>
    v === null ? "—" : `$${Math.round(v).toLocaleString("en-AU")}`;

  return (
    <aside className="ml-4 w-[372px] shrink-0 overflow-y-auto border-l border-hairline pl-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            className="text-[19px] text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            {subscriber.name}
          </h2>
          <p className="mono mt-0.5 truncate text-[11.5px] text-ink-mute">
            {subscriber.email}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="mf-quiet rounded-md p-1 text-ink-mute transition-colors hover:bg-paper-warm"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <SubscriberStatusPill status={subscriber.status} />
        <SourcePill source={subscriber.source} />
      </div>

      {/* Tags. Editable here rather than only in bulk, because most
          tagging happens one person at a time while looking at them. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full py-px pl-2 pr-1 text-[10px] font-semibold"
            style={{ backgroundColor: "#eaeefe", color: "#3c4270" }}
          >
            {t}
            <button
              type="button"
              disabled={tagPending}
              aria-label={`Remove tag ${t}`}
              onClick={() => startTagTransition(async () => { await onRemoveTag(t); })}
              className="mf-quiet rounded-full p-0.5 transition-opacity hover:opacity-60 disabled:opacity-40"
            >
              <X size={9} strokeWidth={2} />
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={tagPending}
          onClick={() => {
            const entered = window.prompt(`Tag ${subscriber.name} with:`, "");
            const label = entered?.trim();
            if (!label) return;
            startTagTransition(async () => { await onAddTag(label); });
          }}
          className="mf-quiet flex items-center gap-1 rounded-full border border-dashed px-2 py-px text-[10px] font-semibold text-ink-mute transition-colors hover:bg-paper-warm disabled:opacity-40"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <TagIcon size={9} strokeWidth={2} />
          Add tag
        </button>
      </div>

      {/* The visual centre of the panel — the thing an external platform
          could never show. */}
      <div
        className="mt-3.5 rounded-[10px] border px-3 py-3"
        style={{ backgroundColor: "#f6f8ff", borderColor: "#cfd7f5" }}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <Landmark size={13} strokeWidth={1.5} className="text-brand" />
          <span
            className="text-[10.5px] font-bold uppercase text-brand"
            style={{ letterSpacing: "0.12em" }}
          >
            Loan context
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Pair label="Lender" value={subscriber.loan.lender || "—"} />
          <Pair label="Owning broker" value={brokerName} />
          {subscriber.source === "back-book" ? (
            <>
              <Pair
                label="Settled"
                value={
                  subscriber.loan.settledOn
                    ? new Date(subscriber.loan.settledOn).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"
                }
              />
              <Pair label="Loan status" value={subscriber.loan.loanStatus ?? "—"} />
              <Pair label="At settlement" value={money(subscriber.loan.loanAmount)} />
              <Pair label="Current balance" value={money(subscriber.loan.currentBalance)} />
            </>
          ) : (
            <>
              <Pair label="Stage" value={stageName ?? "—"} />
              <Pair label="Loan amount" value={money(subscriber.loan.loanAmount)} />
            </>
          )}
        </dl>
        <p className="mt-2.5 border-t pt-2 text-[10.5px] text-ink-mute" style={{ borderColor: "#cfd7f5" }}>
          {subscriber.source === "back-book"
            ? "From the aggregator commission file."
            : "From the live loan pipeline."}
        </p>
      </div>

      <Eyebrow className="mb-2 mt-4">Activity</Eyebrow>
      {events.length === 0 ? (
        <p className="text-[12px] text-ink-mute">
          No campaign activity yet.
        </p>
      ) : (
        <ul className="space-y-0">
          {events.map((e, i) => (
            <li key={`${e.kind}-${e.at.toISOString()}-${i}`} className="flex gap-2.5">
              <span className="flex w-3 shrink-0 flex-col items-center">
                <span
                  className="mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{
                    backgroundColor: DOT_COLOUR[e.kind],
                    boxShadow: `0 0 0 3px ${HALO_COLOUR[e.kind]}`,
                  }}
                />
                {i < events.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-hairline" />
                )}
              </span>
              <span className="flex-1 pb-3">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold text-ink">
                    {e.label}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                    {e.at.toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </span>
                <span className="block text-[11px] text-ink-mute">{e.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** Dot colours follow the chart series, so "clicked" means the same
 *  teal here as it does on a report. */
const DOT_COLOUR: Record<ActivityEvent["kind"], string> = {
  clicked: "var(--color-series-2)",
  opened: "var(--color-series-1)",
  sent: "#c9cbd4",
  unsubscribed: "var(--color-danger)",
  added: "#c9cbd4",
};

const HALO_COLOUR: Record<ActivityEvent["kind"], string> = {
  clicked: "#e3f4f4",
  opened: "#eaeefe",
  sent: "#f1f1f4",
  unsubscribed: "#fbf0ef",
  added: "#f1f1f4",
};

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] text-ink-mute">{label}</dt>
      <dd className="text-[12.5px] font-semibold capitalize text-ink">{value}</dd>
    </div>
  );
}

function SourcePill({ source }: { source: Subscriber["source"] }) {
  const isBackBook = source === "back-book";
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={
        isBackBook
          ? { backgroundColor: "#f3eee4", color: "#6a5b3c" }
          : { backgroundColor: "#f6f8ff", color: "#4151a8" }
      }
    >
      {isBackBook ? "Back-book" : "Pipeline"}
    </span>
  );
}

function SubscriberStatusPill({ status }: { status: Subscriber["status"] }) {
  const tone =
    status === "active"
      ? { bg: "#eef5f0", ink: "#2f6f4a" }
      : status === "bounced"
        ? { bg: "#fbf0ef", ink: "#a3423e" }
        : { bg: "#f4f4f1", ink: "#5f636e" };
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ backgroundColor: tone.bg, color: tone.ink }}
    >
      {status}
    </span>
  );
}

function Th({
  children,
  align = "left",
  width,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  width?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10.5px] font-bold uppercase text-ink-faint",
        align === "right" ? "text-right" : "text-left",
      )}
      style={{ letterSpacing: "0.12em", width }}
    >
      {children}
    </th>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink-soft"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function BulkAction({
  icon: Icon,
  label,
  tone,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  tone?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && !onClick ? "Not yet wired" : undefined}
      className="mf-quiet flex h-[26px] items-center gap-1.5 rounded-md border bg-surface px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50"
      style={{ borderColor: "#c3cdf0", color: tone ?? "var(--color-brand)" }}
    >
      <Icon size={12} strokeWidth={1.5} />
      {label}
    </button>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mf-quiet rounded-md border border-hairline bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-40"
    >
      {children}
    </button>
  );
}

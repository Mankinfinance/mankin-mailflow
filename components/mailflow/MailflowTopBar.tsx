import Link from "next/link";
import { ArrowLeft, Bell, ChevronDown, CircleHelp, Plus } from "lucide-react";
import { StatusPill } from "./StatusPill";

/**
 * The 52px top bar.
 *
 * Two modes. On list surfaces it carries the account controls and the one
 * gold Create button — the module's single CTA, which is why gold appears
 * nowhere else on those screens. On a record (the editor, a report) the
 * left side becomes a back arrow, the record's name, its status and the
 * save state, because that is what you need when you are inside one thing
 * rather than choosing between many.
 */

interface MailflowTopBarProps {
  broker: { name: string; initials: string };
  /** Unread notification dot. */
  unread?: boolean;
  /** Record context — renders the back arrow / name / status variant. */
  record?: {
    name: string;
    status: string;
    backHref: string;
    /** "Saved", "Saving…", or null when there is nothing to report. */
    saveState?: string | null;
  };
  /** The gold Create button. Omitted inside a record. */
  createHref?: string;
  createLabel?: string;
}

export function MailflowTopBar({
  broker,
  unread = false,
  record,
  createHref,
  createLabel = "Create",
}: MailflowTopBarProps) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-hairline bg-surface px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {record && (
          <>
            <Link
              href={record.backHref}
              className="mf-quiet flex h-7 w-7 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-paper-warm hover:text-ink"
              aria-label="Back"
            >
              <ArrowLeft size={15} strokeWidth={1.5} />
            </Link>
            <span className="truncate text-[13px] font-semibold text-ink">
              {record.name}
            </span>
            <StatusPill status={record.status} />
            {record.saveState && (
              <span className="text-[11px] text-ink-faint">{record.saveState}</span>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3.5">
        <button
          type="button"
          className="mf-quiet flex items-center gap-1.5 text-[12px] text-ink-mute transition-colors hover:text-ink"
        >
          <CircleHelp size={14} strokeWidth={1.5} />
          Help
        </button>

        <button
          type="button"
          aria-label="Notifications"
          className="relative text-ink-mute transition-colors hover:text-ink"
        >
          <Bell size={14} strokeWidth={1.5} />
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-deep" />
          )}
        </button>

        <span className="h-[22px] w-px bg-hairline" />

        <button
          type="button"
          className="flex items-center gap-1.5 text-[12px] text-ink-soft"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand">
            {broker.initials}
          </span>
          <span className="hidden sm:inline">{broker.name}</span>
          <ChevronDown size={13} strokeWidth={1.5} className="text-ink-mute" />
        </button>

        {createHref && (
          <Link
            href={createHref}
            className="mf-quiet flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[12.5px] font-bold transition-colors"
            style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
          >
            <Plus size={14} strokeWidth={2} />
            {createLabel}
          </Link>
        )}
      </div>
    </header>
  );
}

import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { AccountMenu, HelpButton } from "./TopBarControls";
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
  record,
  createHref,
  createLabel = "Create",
}: MailflowTopBarProps) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface pl-14 pr-4 md:px-6">
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
            <span className="hidden sm:inline-flex">
              <StatusPill status={record.status} />
            </span>
            {record.saveState && (
              <span className="hidden text-[11px] text-ink-faint sm:inline">{record.saveState}</span>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-3.5">
        <HelpButton />

        <span className="h-[22px] w-px bg-hairline" />

        <AccountMenu name={broker.name} initials={broker.initials} />

        {createHref && (
          <Link
            href={createHref}
            aria-label={createLabel}
            className="mf-quiet flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[12.5px] font-bold transition-colors"
            style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
          >
            <Plus size={14} strokeWidth={2} />
            <span className="hidden sm:inline">{createLabel}</span>
          </Link>
        )}
      </div>
    </header>
  );
}

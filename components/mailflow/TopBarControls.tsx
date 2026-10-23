"use client";

import * as React from "react";
import { ChevronDown, CircleHelp, LayoutGrid, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { LOANFLOW_URL } from "@/lib/loanflow-url";
import { OPEN_ASSISTANT_EVENT } from "./Assistant";

/** Help opens the assistant, which knows every screen by name. */
export function HelpButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}
      className="mf-quiet flex items-center gap-1.5 text-[12px] text-ink-mute transition-colors hover:text-ink"
      aria-label="Help"
    >
      <CircleHelp size={14} strokeWidth={1.5} />
      <span className="hidden sm:inline">Help</span>
    </button>
  );
}

/** Who is signed in, the way back to the launcher, and signing out. */
export function AccountMenu({ name, initials }: { name: string; initials: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="mf-quiet flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] text-ink-soft transition-colors hover:bg-paper-warm"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand">
          {initials}
        </span>
        <span className="hidden sm:inline">{name}</span>
        <ChevronDown
          size={13}
          strokeWidth={1.5}
          className={`text-ink-mute transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[210px] overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-lg"
        >
          <div className="border-b border-hairline px-3 py-2">
            <div className="truncate text-[12.5px] font-semibold text-ink">{name}</div>
            <div className="text-[11px] text-ink-mute">Mankin Finance</div>
          </div>
          <a
            href={LOANFLOW_URL}
            role="menuitem"
            className="mf-quiet flex items-center gap-2 px-3 py-2 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-warm"
          >
            <LayoutGrid size={14} strokeWidth={1.5} />
            Switch to LoanFlow
          </a>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="mf-quiet flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:bg-paper-warm"
            >
              <LogOut size={14} strokeWidth={1.5} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

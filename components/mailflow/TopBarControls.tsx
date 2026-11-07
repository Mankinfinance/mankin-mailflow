"use client";

import * as React from "react";
import { ChevronDown, CircleHelp, Download, LayoutGrid, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { LOANFLOW_URL } from "@/lib/loanflow-url";
import { platform, promptInstall, useInstallState } from "@/lib/pwa-install";
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
  const [howTo, setHowTo] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const install = useInstallState();

  async function installApp() {
    /* The browser's own dialog where it has one (Chrome, Edge); the
       steps where it does not (Safari on iPhone and Mac). The menu
       closes first so it is not left open behind the dialog. */
    if (install.canPrompt) {
      setOpen(false);
      await promptInstall();
      return;
    }
    setHowTo(true);
  }

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
        onClick={() => {
          setOpen((o) => !o);
          setHowTo(false);
        }}
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
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[250px] overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-lg"
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
          {!install.installed && (
            <button
              type="button"
              role="menuitem"
              onClick={installApp}
              className="mf-quiet flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:bg-paper-warm"
            >
              <Download size={14} strokeWidth={1.5} />
              Install Mailflow app
            </button>
          )}
          {howTo && <InstallSteps />}
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

/** How to install where the browser offers no button of its own. */
function InstallSteps() {
  const where = platform();
  return (
    <div className="mx-2 mb-1 rounded-md bg-paper-warm px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
      {where === "ios" ? (
        <>In Safari, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>.</>
      ) : where === "mac-safari" ? (
        <>In Safari&apos;s menu bar, choose <b>File → Add to Dock</b>.</>
      ) : (
        <>
          In <b>Chrome</b> or <b>Edge</b>, click the install icon at the right of
          the address bar. If there is none, open the browser menu (⋮ or ⋯) and
          choose <b>Install Mailflow</b> (Chrome: under <b>Cast, save and share</b>;
          Edge: under <b>Apps</b>).
        </>
      )}
    </div>
  );
}

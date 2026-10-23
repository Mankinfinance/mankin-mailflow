"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/**
 * The left navigation on a phone. Below md the 200px rail would leave
 * the page a 190px strip, so it folds into a drawer behind a menu
 * button that sits in the top bar's left corner. The drawer holds the
 * same server-rendered links as the rail, passed in as children, and
 * closes on navigation and on Escape.
 */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = React.useState(pathname);

  // Close when a link inside the drawer changes the page.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="mf-quiet fixed left-3 top-[10px] z-30 flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-paper-warm md:hidden"
      >
        <Menu size={17} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/30"
          />
          <div className="absolute inset-y-0 left-0 flex w-[260px] max-w-[85vw] flex-col overflow-y-auto border-r border-hairline bg-surface px-3 py-3.5 shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="mf-quiet absolute right-2.5 top-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-paper-warm"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

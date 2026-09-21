"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * PWA installer: registers the service worker on mount and, when the
 * browser offers an install prompt, shows a small floating button so
 * the broker (or customer) can add LoanFlow to their home screen.
 *
 * iOS Safari doesn't fire `beforeinstallprompt`. For those visitors we
 * show a one-line hint with the manual install gesture instead, on the
 * first visit only - dismissable + remembered in localStorage so it
 * doesn't nag.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "loanflow.pwa.dismissed";

export function PwaInstaller() {
  const [prompt, setPrompt] = React.useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    /* Register the service worker. Wrapped in a 'load' listener so the
       SW install doesn't fight with first-paint work. */
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[PWA] SW registration failed", err);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") {
      setHidden(true);
      return;
    }
    /* Skip the prompt entirely when already running standalone (already
       installed). matchMedia handles Android/desktop, navigator the iOS
       case where standalone is a non-standard attribute. */
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setHidden(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    /* iOS Safari: no install prompt event. Detect iOS Safari + first
       visit, show the manual hint. */
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isSafari =
      /Safari/i.test(navigator.userAgent) &&
      !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
    if (isIos && isSafari) setIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === "accepted") setHidden(true);
  }

  function dismiss() {
    setHidden(true);
    setIosHint(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private-mode storage blocked is fine - the prompt just reappears next session */
    }
  }

  if (hidden) return null;
  if (!prompt && !iosHint) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[70] -translate-x-1/2",
        "flex items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2 shadow-lg",
        "text-[12.5px] text-ink",
      )}
      role="dialog"
      aria-label="Install LoanFlow"
    >
      <span aria-hidden>📲</span>
      {prompt ? (
        <>
          <span className="font-semibold">Install LoanFlow</span>
          <span className="text-ink-mute">for one-tap access</span>
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-brand px-2.5 py-1 text-[12px] font-semibold text-surface hover:bg-brand-deep"
          >
            Install
          </button>
        </>
      ) : (
        <span>
          <span className="font-semibold">Add to Home Screen</span>{" "}
          <span className="text-ink-mute">
            via Share <span aria-hidden>⤴</span> → Add to Home Screen.
          </span>
        </span>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ml-1 rounded-md px-1.5 text-ink-mute hover:bg-paper-warm"
      >
        ×
      </button>
    </div>
  );
}

"use client";

import * as React from "react";

/**
 * The browser's "you can install this" offer, kept in one place so the
 * floating prompt and the account menu's "Install Mailflow app" use the
 * same one. Chrome and Edge (Windows, Mac, Android) fire
 * `beforeinstallprompt` once per page load; Safari never does, so on an
 * iPhone or a Mac the menu shows the manual steps instead.
 */

export type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function rememberInstallPrompt(e: InstallEvent | null) {
  deferred = e;
  emit();
}

export function markInstalled() {
  installed = true;
  deferred = null;
  emit();
}

/** Already running as the installed app, not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type Platform = "ios" | "mac-safari" | "other";

export function platform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\//i.test(ua);
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Macintosh/i.test(ua) && isSafari) return "mac-safari";
  return "other";
}

/** Shows the browser's own install dialog. False when it has none to show. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  await e.prompt();
  const choice = await e.userChoice;
  rememberInstallPrompt(null);
  if (choice.outcome === "accepted") markInstalled();
  return true;
}

export function useInstallState() {
  const subscribe = React.useCallback((l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  const canPrompt = React.useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const done = React.useSyncExternalStore(subscribe, () => installed || isStandalone(), () => false);
  return { canPrompt, installed: done };
}

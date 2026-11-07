"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { isNativeApp } from "@/lib/pwa-install";

const noSubscribe = () => () => {};

/** How far to drag before letting go refreshes, in pixels. */
export const PULL_THRESHOLD = 72;

/**
 * Pull-to-refresh, in the Android and iPhone app only.
 *
 * A browser has a reload button and the app does not, so without this a
 * campaign's sending count or a new unsubscribe could only be seen by
 * leaving the screen and coming back. Dragging down from the top of the
 * page re-fetches it in place (router.refresh), keeping anything typed
 * into a form. In a browser this renders nothing and listens to nothing.
 */
export function NativeAppChrome() {
  const router = useRouter();
  // False on the server and in the first client render, so the two match.
  const native = React.useSyncExternalStore(noSubscribe, isNativeApp, () => false);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    if (!native) return;
    let startY: number | null = null;
    let distance = 0;

    const scrollerFor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-mf-scroll]") : null;

    const onStart = (e: TouchEvent) => {
      const scroller = scrollerFor(e.target);
      /* Only from the very top, and never from inside a panel or menu
         that scrolls on its own. */
      startY = scroller && scroller.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        distance = 0;
        setPull(0);
        return;
      }
      // Resistance, so it follows the finger less and less.
      distance = Math.min(PULL_THRESHOLD * 1.6, dy * 0.5);
      setPull(distance);
    };
    const onEnd = () => {
      if (startY !== null && distance >= PULL_THRESHOLD) {
        setRefreshing(true);
        router.refresh();
        window.setTimeout(() => setRefreshing(false), 900);
      }
      startY = null;
      distance = 0;
      setPull(0);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [native, router]);

  if (!native || (pull === 0 && !refreshing)) return null;
  const ready = pull >= PULL_THRESHOLD || refreshing;
  const offset = refreshing ? PULL_THRESHOLD * 0.75 : pull * 0.75;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{ top: `calc(env(safe-area-inset-top) + 52px + ${offset - 36}px)` }}
    >
      <span
        className="flex h-9 items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 text-[12px] font-semibold text-ink-soft shadow-md"
        style={{ opacity: Math.min(1, pull / PULL_THRESHOLD + (refreshing ? 1 : 0)) }}
      >
        <RefreshCw
          size={14}
          strokeWidth={2}
          className={refreshing ? "animate-spin text-brand" : ready ? "text-brand" : "text-ink-mute"}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
        />
        {refreshing ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}

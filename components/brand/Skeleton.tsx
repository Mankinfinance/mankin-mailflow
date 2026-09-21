import { cn } from "@/lib/cn";

/**
 * Brand-themed loading placeholder. Used inside Next.js `loading.tsx`
 * files and any Suspense boundary that needs to reserve space while
 * data loads.
 *
 * Renders as a soft warm-grey bar with a slow shimmer. Two-pulse
 * cadence keeps it calm — no jarring flashing that distracts a
 * broker mid-call.
 */

interface SkeletonProps {
  /** Tailwind sizing — defaults to a single-line text-sized block. */
  className?: string;
  /** Render as a circle (avatars, icon slots). */
  circle?: boolean;
}

export function Skeleton({ className, circle = false }: SkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "animate-pulse bg-paper-warm",
        circle ? "rounded-full" : "rounded-md",
        className,
      )}
    />
  );
}

/** Convenience: a single-line text block at the given width class. */
export function SkelLine({
  width = "w-full",
  height = "h-4",
}: {
  width?: string;
  height?: string;
}) {
  return <Skeleton className={`${width} ${height}`} />;
}

/** Convenience: a stack of N lines for paragraph-like content. */
export function SkelLines({
  count = 3,
  widths,
}: {
  count?: number;
  widths?: string[];
}) {
  const items = Array.from({ length: count }, (_, i) => {
    const w = widths?.[i] ?? (i === count - 1 ? "w-2/3" : "w-full");
    return <SkelLine key={i} width={w} />;
  });
  return <div className="flex flex-col gap-2">{items}</div>;
}

/** Card-shaped panel placeholder used for dashboard tiles + drawer
 *  sections. Renders with the same surface treatment as a real card so
 *  the layout doesn't jump when content lands. */
export function SkelCard({
  className,
  rows = 3,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-hairline-soft bg-surface px-4 py-3",
        className,
      )}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Skeleton circle className="size-6" />
        <Skeleton className="h-4 w-32" />
      </div>
      <SkelLines count={rows} />
    </div>
  );
}

import { cn } from "@/lib/cn";

/**
 * The five campaign states, as pills.
 *
 * Each carries its own fill, ink and border rather than a tinted opacity,
 * so all five stay legible at 11px against warm paper. "Sending" is the
 * one that moves — a pulsing dot, because a campaign mid-flight is the
 * only state where the number on screen is already out of date.
 */

const TONE: Record<
  string,
  { bg: string; ink: string; line: string; dot?: string }
> = {
  draft: { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" },
  scheduled: { bg: "#f6f8ff", ink: "#4151a8", line: "#cfd7f5", dot: "#4151a8" },
  sending: { bg: "#eefafa", ink: "#0a7c7f", line: "#b9dfe0", dot: "#0a7c7f" },
  sent: { bg: "#eef5f0", ink: "#2f6f4a", line: "#cbe0d4" },
  paused: { bg: "#f3eee4", ink: "#8a6a22", line: "#e5d9bd" },
  cancelled: { bg: "#f4f4f1", ink: "#8a8d95", line: "#e2e0d8" },
  failed: { bg: "#fbf0ef", ink: "#a3423e", line: "#eccfcd" },
  bounced: { bg: "#fbf0ef", ink: "#a3423e", line: "#eccfcd" },
  suppressed: { bg: "#f4f4f1", ink: "#5f636e", line: "#e2e0d8" },
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = TONE[status] ?? TONE.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
        className,
      )}
      style={{
        backgroundColor: tone.bg,
        color: tone.ink,
        borderColor: tone.line,
      }}
    >
      {tone.dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "sending" && "mf-pulse",
          )}
          style={{ backgroundColor: tone.dot }}
        />
      )}
      {status}
    </span>
  );
}

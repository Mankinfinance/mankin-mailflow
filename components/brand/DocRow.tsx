import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { StatusChip, type DocStatus } from "./Chip";

interface DocRowProps {
  name: string;
  hint?: string;
  status?: DocStatus;
  note?: string;
  onClick?: () => void;
  /** Suppress the inline StatusChip on the right edge. Set when the
   *  caller is overlaying its own action buttons in that spot (see
   *  ExcludableDocRow) to prevent the chip and the buttons from
   *  rendering on top of each other. The icon on the left still shows
   *  the doc's state. */
  hideStatus?: boolean;
  /** Optional action slot rendered at the right edge inside the flex
   *  row. Use this instead of overlaying absolutely-positioned buttons
   *  on the row - flex makes overlap impossible by construction, and
   *  the slot grows/shrinks with its content. Implies hideStatus. */
  rightSlot?: ReactNode;
}

export function DocRow({
  name,
  hint,
  status = "pending",
  note,
  onClick,
  hideStatus = false,
  rightSlot,
}: DocRowProps) {
  const suppressChip = hideStatus || !!rightSlot;
  const isDone = status === "received";
  const isOverdue = status === "overdue";
  const isAdvise = status === "stale" || status === "incomplete";

  const containerTone = cn(
    "border-hairline",
    isDone && "bg-ok-soft border-[oklch(85%_0.06_155)]",
    isOverdue && "bg-danger-soft border-[oklch(85%_0.08_25)]",
    isAdvise && "bg-[oklch(97%_0.04_80)] border-[oklch(85%_0.08_80)]",
  );

  const iconTone = cn(
    "size-[22px] shrink-0 rounded-md grid place-items-center text-[13px] font-bold mt-0.5",
    isDone && "bg-ok text-surface",
    isOverdue && "bg-surface border-[1.5px] border-danger text-danger",
    isAdvise && "bg-[oklch(72%_0.13_70)] text-surface",
    !isDone && !isOverdue && !isAdvise && "bg-surface border-[1.5px] border-ink-faint text-transparent",
  );

  const iconGlyph = isDone ? "✓" : isAdvise ? (status === "stale" ? "↻" : "⚠") : isOverdue ? "!" : "";

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors",
        containerTone,
        onClick && "cursor-pointer hover:brightness-[0.99]",
      )}
    >
      <div className={iconTone}>{iconGlyph}</div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-[14px] font-semibold text-ink",
            isDone && "line-through opacity-60",
          )}
        >
          {name}
        </div>
        {hint && (
          <div className="mt-0.5 text-[12px] leading-[1.45] text-ink-mute">{hint}</div>
        )}
        {note && (
          <div className="mt-1.5 rounded-md border-l-2 border-[oklch(72%_0.13_70)] bg-white/60 px-2.5 py-1.5 text-[12px] font-medium leading-[1.45] text-[oklch(35%_0.11_65)]">
            <b className="font-bold">Action needed:</b> {note}
          </div>
        )}
      </div>
      {rightSlot ? (
        <div
          className="flex shrink-0 items-center gap-1.5 self-start"
          onClick={(e) => e.stopPropagation()}
        >
          {rightSlot}
        </div>
      ) : (
        !suppressChip && <StatusChip status={status} />
      )}
    </div>
  );
}

import Image from "next/image";
import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "dark" | "light";

const HEIGHTS: Record<Size, number> = { sm: 28, md: 38, lg: 56, xl: 72 };

interface LogoProps {
  size?: Size;
  tone?: Tone;
  mark?: boolean;
  className?: string;
}

export function Logo({ size = "md", tone = "dark", mark = false, className }: LogoProps) {
  const h = HEIGHTS[size];
  if (mark) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-lg font-medium italic select-none",
          tone === "light" ? "bg-surface text-brand" : "bg-brand text-surface",
          className,
        )}
        style={{
          width: h,
          height: h,
          fontFamily: "var(--font-display)",
          fontSize: h * 0.55,
          letterSpacing: "-0.02em",
        }}
      >
        M.
      </div>
    );
  }
  const w = Math.round(h * (438 / 357));
  return (
    <Image
      src="/brand/mankin-logo.png"
      alt="Mankin Finance"
      width={w}
      height={h}
      priority
      className={cn("block max-w-none", tone === "light" && "invert brightness-125", className)}
      style={{ width: w, height: h }}
    />
  );
}

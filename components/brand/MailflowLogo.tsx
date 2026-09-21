import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "dark" | "light";

const MARK_SIZES: Record<Size, number> = { sm: 28, md: 38, lg: 56, xl: 72 };

interface MailflowLogoProps {
  /** Mark height in pixels. md (default) for inline UI, lg+ for hero blocks. */
  size?: Size;
  /** "dark" renders on light backgrounds (default). "light" inverts for use on
   *  the brand navy. */
  tone?: Tone;
  /** When true, renders the icon mark only - no wordmark. */
  mark?: boolean;
  /** Optional strapline under the wordmark, in wide-tracked small caps. */
  tagline?: string;
  className?: string;
}

/**
 * Mailflow brand mark + wordmark. Deliberately a sibling of
 * LoanflowLogo, not a stranger.
 *
 * Same pill language, same flow arc, same geometry — but the pills lie
 * left-aligned and descending rather than stepping up to the right, so
 * they read as the lines of a written message instead of stages of a
 * loan. The accent moves to the top pill: on LoanFlow the accent is the
 * last cell, the settled one, because that is where a loan is going.
 * On Mailflow it is the first line, the subject, because that is what
 * decides whether the rest gets read.
 *
 * The accent colour is the warm gold already used for calls to action,
 * against LoanFlow's green. Two products off one palette, told apart at
 * a glance without either inventing a colour of its own.
 */
export function MailflowLogo({
  size = "md",
  tone = "dark",
  mark = false,
  tagline,
  className,
}: MailflowLogoProps) {
  const h = MARK_SIZES[size];
  const primary = tone === "light" ? "#ffffff" : "#1c2566";
  const accent = tone === "light" ? "#f0c26a" : "#c98f2b";

  const markSvg = (
    <svg
      viewBox="0 0 64 64"
      width={h}
      height={h}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mailflow mark"
      style={{ display: "block" }}
    >
      <rect x="6" y="18" width="46" height="6" rx="3" fill={accent} />
      <rect x="6" y="29" width="34" height="6" rx="3" fill={primary} />
      <rect x="6" y="40" width="22" height="6" rx="3" fill={primary} />
      <path
        d="M 8 52 Q 32 60 56 46"
        stroke={primary}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
        opacity={tone === "light" ? 0.5 : 0.32}
      />
    </svg>
  );

  if (mark) {
    return <span className={cn("inline-block", className)}>{markSvg}</span>;
  }

  const wordSize = Math.round(h * 0.62);
  const taglineSize = Math.max(10, Math.round(h * 0.18));

  return (
    <span
      className={cn("inline-flex items-center gap-3", className)}
      aria-label={tagline ? `Mailflow - ${tagline}` : "Mailflow"}
    >
      {markSvg}
      <span className="inline-flex flex-col" style={{ lineHeight: 1 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: wordSize,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: primary,
          }}
        >
          Mailflow
        </span>
        {tagline && (
          <span
            style={{
              marginTop: Math.round(h * 0.08),
              fontSize: taglineSize,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: primary,
              opacity: 0.7,
            }}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}

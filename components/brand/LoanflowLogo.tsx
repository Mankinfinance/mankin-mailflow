import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "dark" | "light";

const MARK_SIZES: Record<Size, number> = { sm: 28, md: 38, lg: 56, xl: 72 };

interface LoanflowLogoProps {
  /** Mark height in pixels. md (default) for inline UI, lg+ for hero blocks. */
  size?: Size;
  /** "dark" renders on light backgrounds (default). "light" inverts for use on
   *  the brand navy. */
  tone?: Tone;
  /** When true, renders the icon mark only - no wordmark. Use as favicon /
   *  app icon / compact header chip. */
  mark?: boolean;
  /** Override the rendered wordmark text. Defaults to "LoanFlow". */
  label?: string;
  /** Optional strapline under the wordmark, rendered in small caps with
   *  wide letter-spacing. e.g. "Pipeline · Settled". */
  tagline?: string;
  className?: string;
}

/**
 * LoanFlow brand mark + wordmark.
 *
 * The mark is three rounded pills stepping up to the right, ending in a
 * brand-green pill (the "settled" cell). A faint arc beneath reads as
 * forward flow. The whole thing reads as "loan, moving through stages,
 * landing settled". Designed to sit next to Mankin Finance branding
 * without competing with it.
 *
 * Inline SVG so the strokes stay crisp at every size and the colours can
 * be themed off CSS variables when we later want to (currently hard-coded
 * to the brand palette for simplicity).
 */
export function LoanflowLogo({
  size = "md",
  tone = "dark",
  mark = false,
  label = "LoanFlow",
  tagline,
  className,
}: LoanflowLogoProps) {
  const h = MARK_SIZES[size];
  const primary = tone === "light" ? "#ffffff" : "#1c2566";
  const accent = tone === "light" ? "#7ed3ad" : "#2b6e4f";

  const markSvg = (
    <svg
      viewBox="0 0 64 64"
      width={h}
      height={h}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="LoanFlow mark"
      style={{ display: "block" }}
    >
      <rect x="6" y="36" width="14" height="6" rx="3" fill={primary} />
      <rect x="25" y="29" width="14" height="6" rx="3" fill={primary} />
      <rect x="44" y="22" width="14" height="6" rx="3" fill={accent} />
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

  /* Wordmark is sized off the mark height so the cap-height of the text
     lines up with the top of the tallest pill, and the baseline sits
     just above the flow arc. Newsreader display face matches the
     brand-wide H1 treatment. */
  const wordSize = Math.round(h * 0.62);

  /* Tagline sits under the wordmark in wide-tracked small caps so it
     reads as a strapline rather than competing with the brand. */
  const taglineSize = Math.max(10, Math.round(h * 0.18));

  return (
    <span
      className={cn("inline-flex items-center gap-3", className)}
      aria-label={tagline ? `${label} - ${tagline}` : label}
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
          {label}
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

"use client";

import * as React from "react";
import type { ContactSeries } from "@/lib/campaigns/dashboard";

/**
 * Active contacts over the last 30 days.
 *
 * One series, so no legend — the title names it. The important decision
 * is the y-domain: it is held to a minimum window (see holdAxis) rather
 * than auto-scaled, because a book that moves by two contacts a month
 * against an auto axis renders every routine unsubscribe as a collapse.
 * The subhead states that, so nobody reads the flatness as a bug.
 *
 * The typical-range band and the single annotated marker do the work a
 * dense line would otherwise have to: you can see at a glance that
 * nothing unusual happened, and exactly where the one thing that did.
 */

const W = 1000;
const H = 168;
const LEFT = 42;
const RIGHT = 980;
const TOP = 20;
const BOTTOM = 130;

export function ContactGrowthChart({ series }: { series: ContactSeries }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const { points, min, max } = series;

  if (points.length === 0) return null;

  const x = (i: number) => LEFT + (i / (points.length - 1)) * (RIGHT - LEFT);
  const y = (v: number) => BOTTOM - ((v - min) / (max - min)) * (BOTTOM - TOP);

  const line = points.map((p, i) => `${x(i)},${y(p.contacts)}`).join(" ");
  const ticks = [max, Math.round((max + min) / 2), min];

  /** The one point worth annotating: the lowest, when it is below the
   *  steady level. A flat series gets no marker at all. */
  const lowIndex = points.reduce(
    (lowest, p, i) => (p.contacts < points[lowest].contacts ? i : lowest),
    0,
  );
  const steady = points[points.length - 1].contacts;
  const showMarker = points[lowIndex].contacts < steady;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(
      ((ratio * W - LEFT) / (RIGHT - LEFT)) * (points.length - 1),
    );
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const labelIndexes = [0, Math.floor(points.length / 3), Math.floor((points.length * 2) / 3), points.length - 1];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[186px] w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Active contacts over the last 30 days"
      >
        {/* Typical range, behind the grid. */}
        <rect
          x={LEFT}
          y={y(series.typicalHigh)}
          width={RIGHT - LEFT}
          height={Math.max(2, y(series.typicalLow) - y(series.typicalHigh))}
          fill="#eaeefe"
          opacity={0.85}
        />

        {ticks.map((t, i) => (
          <g key={`${t}-${i}`}>
            <line
              x1={LEFT}
              x2={RIGHT}
              y1={y(t)}
              y2={y(t)}
              stroke={i === ticks.length - 1 ? "var(--color-grid-baseline)" : "var(--color-grid)"}
              strokeWidth={1}
            />
            <text
              x={LEFT - 8}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill={i === 1 ? "var(--color-ink-mute)" : "var(--color-axis-label)"}
            >
              {t}
            </text>
          </g>
        ))}

        <polyline
          points={line}
          fill="none"
          stroke="var(--color-series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {showMarker && (
          <g>
            <line
              x1={x(lowIndex)}
              x2={x(lowIndex)}
              y1={y(points[lowIndex].contacts)}
              y2={BOTTOM}
              stroke="var(--color-axis-label)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <circle
              cx={x(lowIndex)}
              cy={y(points[lowIndex].contacts)}
              r={4}
              fill="#fff"
              stroke="var(--color-series-1)"
              strokeWidth={2}
            />
            <text
              x={x(lowIndex) + 8}
              y={y(points[lowIndex].contacts) - 6}
              fontSize={10.5}
              fontWeight={600}
              fill="var(--color-ink)"
            >
              {points[lowIndex].contacts} on{" "}
              {new Date(points[lowIndex].date).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
              })}
            </text>
          </g>
        )}

        {labelIndexes.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={BOTTOM + 16}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-axis-label)"
          >
            {new Date(points[i].date).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "short",
            })}
          </text>
        ))}

        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={TOP}
              y2={BOTTOM}
              stroke="#b9bcc6"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(points[hover].contacts)}
              r={4.5}
              fill="#fff"
              stroke="var(--color-series-1)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-hairline bg-surface px-2.5 py-1.5"
          style={{
            left: `${Math.min(84, (x(hover) / W) * 100)}%`,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="text-[10.5px] text-ink-mute">
            {new Date(points[hover].date).toLocaleDateString("en-AU", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </div>
          <div className="text-[13px] font-semibold tabular-nums text-ink">
            {points[hover].contacts} contacts
          </div>
        </div>
      )}
    </div>
  );
}

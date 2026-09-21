"use client";

import * as React from "react";

/**
 * Cumulative opens and clicks over the 72 hours after a send.
 *
 * Both series count people, so they share one axis — which is how this
 * chart honours the no-dual-axis rule rather than working around it.
 * Clicks sit far below opens on that shared scale, and that gap is the
 * finding, not a rendering problem to fix with a second axis.
 *
 * Direct end-of-series labels instead of a number on every point, and a
 * crosshair that follows the pointer.
 */

export interface CurvePoint {
  /** Hours since the first recipient was dispatched. */
  hour: number;
  opens: number;
  clicks: number;
}

const W = 1000;
const H = 218;
const LEFT = 40;
const RIGHT = 980;
const TOP = 20;
const BOTTOM = 190;

export function EngagementCurve({ points }: { points: CurvePoint[] }) {
  const [hover, setHover] = React.useState<CurvePoint | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const peak = Math.max(1, ...points.map((p) => p.opens));
  /** Round the domain up to something a person would choose. */
  const yMax = niceCeiling(peak);

  const x = (hour: number) => LEFT + (hour / 72) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - (value / yMax) * (BOTTOM - TOP);

  const line = (key: "opens" | "clicks") =>
    points.map((p) => `${x(p.hour)},${y(p[key])}`).join(" ");

  const last = points[points.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const hour = Math.max(0, Math.min(72, ((ratio * W - LEFT) / (RIGHT - LEFT)) * 72));
    let nearest = points[0];
    for (const p of points) {
      if (Math.abs(p.hour - hour) < Math.abs(nearest.hour - hour)) nearest = p;
    }
    setHover(nearest);
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[250px] w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Cumulative opens and clicks over the 72 hours after send"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={LEFT}
              x2={RIGHT}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--color-grid-baseline)" : "var(--color-grid)"}
              strokeWidth={1}
            />
            <text
              x={LEFT - 8}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-axis-label)"
            >
              {t}
            </text>
          </g>
        ))}

        {[0, 12, 24, 48, 72].map((h) => (
          <text
            key={h}
            x={x(h)}
            y={BOTTOM + 16}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-axis-label)"
          >
            {h === 0 ? "send" : `${h}h`}
          </text>
        ))}

        <polyline
          points={line("opens")}
          fill="none"
          stroke="var(--color-series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={line("clicks")}
          fill="none"
          stroke="var(--color-series-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {last && (
          <>
            <text
              x={Math.min(x(last.hour) + 8, RIGHT)}
              y={y(last.opens) + 3}
              fontSize={10.5}
              fontWeight={600}
              fill="var(--color-series-1)"
            >
              {last.opens} opens
            </text>
            <text
              x={Math.min(x(last.hour) + 8, RIGHT)}
              y={y(last.clicks) + 3}
              fontSize={10.5}
              fontWeight={600}
              fill="var(--color-series-2)"
            >
              {last.clicks} clicks
            </text>
          </>
        )}

        {hover && (
          <g>
            <line
              x1={x(hover.hour)}
              x2={x(hover.hour)}
              y1={TOP}
              y2={BOTTOM}
              stroke="#b9bcc6"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={x(hover.hour)} cy={y(hover.opens)} r={4.5} fill="#fff" stroke="var(--color-series-1)" strokeWidth={2} />
            <circle cx={x(hover.hour)} cy={y(hover.clicks)} r={4.5} fill="#fff" stroke="var(--color-series-2)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-hairline bg-surface px-2.5 py-2"
          style={{
            left: `${Math.min(88, (x(hover.hour) / W) * 100)}%`,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="mb-1 text-[9.5px] font-bold uppercase text-ink-faint"
            style={{ letterSpacing: "0.12em" }}
          >
            {Math.round(hover.hour)} hours after send
          </div>
          <Row colour="var(--color-series-1)" label="Opens" value={hover.opens} />
          <Row colour="var(--color-series-2)" label="Clicks" value={hover.clicks} />
        </div>
      )}
    </div>
  );
}

function Row({
  colour,
  label,
  value,
}: {
  colour: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
      <span className="flex-1 text-ink-mute">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** 94 → 100, 7 → 10, 340 → 400. Keeps the axis on numbers a person
 *  would have picked. */
function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

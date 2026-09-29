"use client";

// A small, dependency-free chart kit for the admin dashboard.
//
// Every chart here is plain SVG/HTML sized to its container, so there is no
// charting library in the bundle and the marks match the app's own chrome.
// Three rules shape the look and are worth keeping when adding a chart:
//   • thin marks, hairline grid, generous air — the data is the only loud thing;
//   • 2px surface gaps do the separating (never a stroke around a mark);
//   • every chart ships a hover/focus readout AND a table view, so no value is
//     reachable only by pointing at it.

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./ui";

// --- palette ----------------------------------------------------------------
// The categorical order and both ramps were checked against this app's white
// card surface: lightness band, chroma floor, colour-vision separation and
// contrast all pass. Slot 4 (yellow) and slot 5 (pink) sit below 3:1 on white,
// which is why every chart also carries direct labels and a table view.

/** Categorical hues, in fixed order. Colour follows the entity, never its rank
 *  — index a series by its own key so filtering never repaints the survivors. */
export const SERIES_COLORS = [
  "#0d9488", // teal — the brand hue leads
  "#eb6834", // orange
  "#2a78d6", // blue
  "#eda100", // yellow
  "#e87ba4", // pink
  "#4a3aa7", // violet
] as const;

/** One-hue ramp for ordered stages (a funnel, tiers). The light end still
 *  clears the surface at 2.1:1. */
export const ORDINAL_TEAL = [
  "#5cc3b6",
  "#2eae9e",
  "#0d9488",
  "#0b7d72",
  "#0a6660",
  "#08504b",
] as const;

/** One-hue ramp for continuous magnitude (the heatmap). The lightest step is
 *  allowed to recede toward the surface — it means "near zero". */
export const SEQUENTIAL_TEAL = [
  "#eef7f5",
  "#d2ece7",
  "#a9dbd3",
  "#78cabf",
  "#38b3a4",
  "#0d9488",
  "#0b7d72",
] as const;

export const INK = {
  primary: "#10201d",
  secondary: "#52605c",
  muted: "#7c8783",
  grid: "#e7edeb",
  axis: "#cdd8d5",
  surface: "#ffffff",
  good: "#0ca30c",
  critical: "#d03b3b",
} as const;

// --- shared types -----------------------------------------------------------

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartPoint {
  /** Short axis label. */
  label: string;
  /** Long label used in the readout. */
  full?: string;
  values: Record<string, number>;
}

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

type Formatter = (n: number) => string;

const identityFormat: Formatter = (n) =>
  Number.isInteger(n)
    ? n.toLocaleString("en-KE")
    : n.toLocaleString("en-KE", { maximumFractionDigits: 2 });

// --- helpers ----------------------------------------------------------------

/** Width of the element, tracked live so the SVG can be drawn at real pixels
 *  (a stretched viewBox would distort strokes and text).
 *
 *  This is a callback ref, not an effect over `ref.current`, because a chart's
 *  plot is a conditional subtree: while the store is still loading the chart
 *  renders its empty state instead, so the measured node appears *after* mount.
 *  An effect with an empty dependency list would have run once against nothing
 *  and left the width at 0 forever — a permanently blank chart. */
function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(node);
    observer.current = ro;
  }, []);
  return [ref, width] as const;
}

/** Round a value up to one people read easily (1 / 2 / 2.5 / 5 ×10ⁿ). */
function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** An axis whose ticks land on round numbers — the gridline values carry every
 *  point that isn't direct-labelled, so 0 / 10k / 20k has to beat 0 / 13k / 25k.
 *  `integer` keeps a count axis off fractional steps. */
function niceScale(
  rawMax: number,
  tickCount: number,
  integer = false,
): { max: number; ticks: number[] } {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return { max: 1, ticks: [0, 1] };
  let step = niceMax(rawMax / tickCount);
  if (integer) step = Math.max(1, Math.ceil(step));
  const max = step * Math.ceil(rawMax / step);
  const ticks: number[] = [];
  for (let t = 0; t <= max + step / 1000; t += step) ticks.push(t);
  return { max, ticks };
}

/** Column path with a 4px rounded cap and square feet on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const b = y + h;
  return `M${x},${b} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${b} Z`;
}

/** At most `max` axis labels, evenly spaced. Labels are anchored at the LAST
 *  point and stepped backwards, so the newest period is always named and no
 *  label can end up jammed against it — "6 Sept" overprinting "7 Sept" is the
 *  failure mode of keeping every nth label and then bolting the last one on. */
function labelStride(count: number, max: number): number {
  return Math.max(1, Math.ceil(count / max));
}

function isLabelled(index: number, count: number, stride: number): boolean {
  return (count - 1 - index) % stride === 0;
}

/** Drop ticks whose label repeats the one below it — a rounding formatter on a
 *  small scale would otherwise print "0 / 1 / 1". */
function distinctTicks(ticks: number[], format: Formatter): number[] {
  const seen = new Set<string>();
  return ticks.filter((t) => {
    const label = format(t);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

/** True when there is nothing to plot — every series is zero at every point. */
function allZero(points: ChartPoint[], series: ChartSeries[]): boolean {
  return points.every((p) => series.every((s) => (p.values[s.key] ?? 0) === 0));
}

// --- chrome -----------------------------------------------------------------

/** A chart's frame: title, optional note, and the chart/table switch that
 *  keeps every plotted value readable without a pointer. */
export function ChartCard({
  title,
  subtitle,
  table,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  table?: TableView;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-teal-950/[0.07] bg-white p-4 shadow-[0_1px_2px_rgb(4_47_43/0.04),0_10px_26px_-16px_rgb(4_47_43/0.16)]",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-teal-950">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {table && (
            <div className="flex rounded-full border border-zinc-200 p-0.5">
              {(["chart", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                    view === v
                      ? "bg-teal-700 text-white"
                      : "text-zinc-500 hover:text-teal-900",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {view === "chart" || !table ? children : <DataTable {...table} />}
      </div>
    </section>
  );
}

export function DataTable({ columns, rows }: TableView) {
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-zinc-100">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "px-3 py-2 font-medium",
                  i > 0 && "text-right tabular-nums",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3 py-1.5 text-zinc-700",
                    ci > 0 && "text-right tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-zinc-400"
              >
                Nothing recorded in this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Identity never rides on colour alone — every multi-series chart shows this. */
export function Legend({
  items,
  shape = "rect",
}: {
  items: { label: string; color: string; value?: string }[];
  shape?: "rect" | "line";
}) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              shape === "line" ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-sm",
            )}
            style={{ background: it.color }}
          />
          <span className="text-zinc-600">{it.label}</span>
          {it.value && (
            <span className="font-medium tabular-nums text-zinc-900">{it.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The hover/focus readout: value first, series name second — the reader
 *  already knows which series they are on and wants the number. */
function Readout({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: { label: string; value: string; color: string }[];
}) {
  const clamped = Math.min(Math.max(x, 80), Math.max(width - 80, 80));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-teal-950/10 bg-white/95 px-2.5 py-2 shadow-lg"
      style={{ left: clamped }}
    >
      <p className="mb-1 whitespace-nowrap text-[11px] text-zinc-500">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center gap-2 whitespace-nowrap text-xs"
          >
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
            <span className="font-semibold tabular-nums text-zinc-900">{r.value}</span>
            <span className="text-zinc-500">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-32 place-items-center rounded-xl border border-dashed border-teal-900/15 px-4 text-center text-xs text-zinc-400">
      {children}
    </div>
  );
}

// --- stat tiles -------------------------------------------------------------

/** The trend behind a stat tile: context, not a chart to read values off. */
export function Sparkline({
  values,
  color = SERIES_COLORS[0],
  height = 34,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gradientId = useId();
  const pts = values.length > 1 ? values : [...values, ...values];
  const max = niceMax(Math.max(...pts, 0));
  const step = width > 0 ? width / (pts.length - 1) : 0;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const line = pts.map((v, i) => `${i * step},${y(v)}`).join(" L");
  const last = pts.length - 1;

  return (
    <div ref={ref} style={{ height }} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} aria-hidden focusable="false">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`M${line} L${last * step},${height} L0,${height} Z`}
            fill={`url(#${gradientId})`}
          />
          <path
            d={`M${line}`}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={last * step}
            cy={y(pts[last])}
            r={3}
            fill={color}
            stroke={INK.surface}
            strokeWidth={2}
          />
        </svg>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  delta,
  goodWhenUp = true,
  trend,
  color = SERIES_COLORS[0],
}: {
  label: string;
  value: string;
  hint?: string;
  /** Percentage change vs the comparison window; null/undefined hides it. */
  delta?: number | null;
  goodWhenUp?: boolean;
  trend?: number[];
  color?: string;
}) {
  const hasDelta = delta !== null && delta !== undefined;
  const flat = hasDelta && Math.abs(delta) < 0.5;
  const up = (delta ?? 0) > 0;
  const good = up === goodWhenUp;
  return (
    <div className="flex flex-col rounded-2xl border border-teal-950/[0.07] bg-white p-4 shadow-[0_1px_2px_rgb(4_47_43/0.04),0_10px_26px_-16px_rgb(4_47_43/0.16)]">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-teal-950">
        {value}
      </p>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 text-xs">
        {hasDelta && (
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: flat ? INK.secondary : good ? INK.good : INK.critical }}
          >
            <span aria-hidden>{flat ? "→" : up ? "↑" : "↓"}</span>
            {flat ? "flat" : `${Math.abs(delta).toFixed(0)}%`}
          </span>
        )}
        {hint && <span className="text-zinc-400">{hint}</span>}
      </div>
      {/* A sparkline of nothing is a straight line pretending to be a trend. */}
      {trend && trend.length > 1 && trend.some((v) => v > 0) && (
        <div className="mt-2">
          <Sparkline values={trend} color={color} />
        </div>
      )}
    </div>
  );
}

// --- trend (line / area) ----------------------------------------------------

/** Change over time. One series draws as an area; several draw as lines with a
 *  legend. A crosshair snaps to the nearest position so the reader aims at a
 *  date, never at a 2px line. */
export function TrendChart({
  points,
  series,
  format = identityFormat,
  formatAxis,
  integerAxis = false,
  height = 220,
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  format?: Formatter;
  formatAxis?: Formatter;
  integerAxis?: boolean;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const { max, ticks } = useMemo(
    () =>
      niceScale(
        Math.max(
          0,
          ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)),
        ),
        4,
        integerAxis,
      ),
    [points, series, integerAxis],
  );

  const pad = { top: 14, right: 16, bottom: 24, left: 54 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = Math.max(0, height - pad.top - pad.bottom);
  const n = points.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const xOf = (i: number) => pad.left + (n > 1 ? i * step : plotW / 2);
  const yOf = (v: number) => pad.top + plotH - (v / max) * plotH;

  if (n === 0 || allZero(points, series))
    return <ChartEmpty>No activity in this period.</ChartEmpty>;

  const stride = labelStride(n, Math.max(2, Math.floor(plotW / 76)));
  const axisFormat = formatAxis ?? format;
  const axisTicks = distinctTicks(ticks, axisFormat);
  const point = active === null ? null : points[active];

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`${series.map((s) => s.label).join(" and ")} over time — ${n} points. Use the arrow keys to step through them, or switch to the table view.`}
          className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = e.clientX - rect.left - pad.left;
            const i = step > 0 ? Math.round(rel / step) : 0;
            setActive(Math.min(n - 1, Math.max(0, i)));
          }}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            setActive((a) => {
              const next = (a ?? 0) + (e.key === "ArrowRight" ? 1 : -1);
              return Math.min(n - 1, Math.max(0, next));
            });
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={series[0].color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={series[0].color} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {axisTicks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke={t === 0 ? INK.axis : INK.grid}
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={yOf(t) + 3}
                textAnchor="end"
                fontSize={10}
                fill={INK.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {axisFormat(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            isLabelled(i, n, stride) ? (
              <text
                key={`${p.label}-${i}`}
                x={xOf(i)}
                y={height - 7}
                textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
                fontSize={10}
                fill={INK.muted}
              >
                {p.label}
              </text>
            ) : null,
          )}

          {series.length === 1 && n > 1 && (
            <path
              d={`M${points
                .map((p, i) => `${xOf(i)},${yOf(p.values[series[0].key] ?? 0)}`)
                .join(" L")} L${xOf(n - 1)},${pad.top + plotH} L${xOf(0)},${pad.top + plotH} Z`}
              fill={`url(#${gradientId})`}
            />
          )}

          {series.map((s) =>
            n > 1 ? (
              <path
                key={s.key}
                d={`M${points
                  .map((p, i) => `${xOf(i)},${yOf(p.values[s.key] ?? 0)}`)
                  .join(" L")}`}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle
                key={s.key}
                cx={xOf(0)}
                cy={yOf(points[0].values[s.key] ?? 0)}
                r={4}
                fill={s.color}
              />
            ),
          )}

          {/* End marker, so the latest value reads without hovering. */}
          {series.length === 1 && n > 1 && (
            <circle
              cx={xOf(n - 1)}
              cy={yOf(points[n - 1].values[series[0].key] ?? 0)}
              r={4}
              fill={series[0].color}
              stroke={INK.surface}
              strokeWidth={2}
            />
          )}

          {active !== null && (
            <>
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={pad.top}
                y2={pad.top + plotH}
                stroke={INK.axis}
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={xOf(active)}
                  cy={yOf(points[active].values[s.key] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke={INK.surface}
                  strokeWidth={2}
                />
              ))}
            </>
          )}
        </svg>
      )}

      {point && active !== null && (
        <Readout
          x={xOf(active)}
          width={width}
          title={point.full ?? point.label}
          rows={series.map((s) => ({
            label: s.label,
            color: s.color,
            value: format(point.values[s.key] ?? 0),
          }))}
        />
      )}

      {series.length > 1 && (
        <Legend
          shape="line"
          items={series.map((s) => ({ label: s.label, color: s.color }))}
        />
      )}
    </div>
  );
}

// --- columns ----------------------------------------------------------------

/** Grouped columns for comparing a couple of series across periods. The whole
 *  band is the hit target, and the readout lists every series at that x. */
export function ColumnChart({
  points,
  series,
  format = identityFormat,
  formatAxis,
  integerAxis = false,
  height = 220,
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  format?: Formatter;
  formatAxis?: Formatter;
  integerAxis?: boolean;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const { max, ticks } = useMemo(
    () =>
      niceScale(
        Math.max(
          0,
          ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)),
        ),
        2,
        integerAxis,
      ),
    [points, series, integerAxis],
  );

  const pad = { top: 14, right: 16, bottom: 24, left: 54 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = Math.max(0, height - pad.top - pad.bottom);
  const n = points.length;

  if (n === 0 || allZero(points, series))
    return <ChartEmpty>No activity in this period.</ChartEmpty>;

  const band = plotW / n;
  // Cap the mark and leave the band's slack as air, with a 2px surface gap
  // between the bars of a group.
  const barW = Math.max(
    2,
    Math.min(22, (band * 0.68 - (series.length - 1) * 2) / series.length),
  );
  const groupW = barW * series.length + (series.length - 1) * 2;
  const stride = labelStride(n, Math.max(2, Math.floor(plotW / 76)));
  const axisFormat = formatAxis ?? format;
  const axisTicks = distinctTicks(ticks, axisFormat);
  const point = active === null ? null : points[active];

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`${series.map((s) => s.label).join(" and ")} by period — ${n} bars. Use the arrow keys to step through them, or switch to the table view.`}
          className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            setActive((a) => {
              const next = (a ?? 0) + (e.key === "ArrowRight" ? 1 : -1);
              return Math.min(n - 1, Math.max(0, next));
            });
          }}
        >
          {axisTicks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={pad.top + plotH - (t / max) * plotH}
                y2={pad.top + plotH - (t / max) * plotH}
                stroke={t === 0 ? INK.axis : INK.grid}
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={pad.top + plotH - (t / max) * plotH + 3}
                textAnchor="end"
                fontSize={10}
                fill={INK.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {axisFormat(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const cx = pad.left + band * i + band / 2;
            return (
              <g key={`${p.label}-${i}`}>
                {series.map((s, si) => {
                  const h = ((p.values[s.key] ?? 0) / max) * plotH;
                  const x = cx - groupW / 2 + si * (barW + 2);
                  return h > 0 ? (
                    <path
                      key={s.key}
                      d={columnPath(x, pad.top + plotH - h, barW, h)}
                      fill={s.color}
                      opacity={active === null || active === i ? 1 : 0.45}
                    />
                  ) : null;
                })}
                {isLabelled(i, n, stride) && (
                  <text
                    x={cx}
                    y={height - 7}
                    textAnchor="middle"
                    fontSize={10}
                    fill={INK.muted}
                  >
                    {p.label}
                  </text>
                )}
                {/* Hit area spans the whole band — never just the painted bar. */}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerMove={() => setActive(i)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {point && active !== null && (
        <Readout
          x={pad.left + band * active + band / 2}
          width={width}
          title={point.full ?? point.label}
          rows={series.map((s) => ({
            label: s.label,
            color: s.color,
            value: format(point.values[s.key] ?? 0),
          }))}
        />
      )}

      {series.length > 1 && (
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      )}
    </div>
  );
}

// --- ranked bars ------------------------------------------------------------

export interface BarItem {
  label: string;
  value: number;
  /** Trailing note, e.g. "12 visits". */
  meta?: string;
}

/** Magnitude across nominal categories: one hue for every bar (the bar's length
 *  already carries the value — colouring by size would say it twice), with the
 *  value direct-labelled so nothing depends on hovering. */
export function BarList({
  items,
  format = identityFormat,
  color = SERIES_COLORS[0],
  max: fixedMax,
}: {
  items: BarItem[];
  format?: Formatter;
  color?: string;
  max?: number;
}) {
  if (items.length === 0)
    return <ChartEmpty>Nothing recorded in this period.</ChartEmpty>;
  const max = fixedMax ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-zinc-600" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-900">
              {format(item.value)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2.5 flex-1 rounded-sm bg-zinc-100">
              <div
                className="h-full rounded-r-sm transition-[width] duration-500"
                style={{
                  width: `${item.value > 0 ? Math.max(2, (item.value / max) * 100) : 0}%`,
                  background: color,
                }}
              />
            </div>
            {item.meta && (
              <span className="w-20 shrink-0 text-right text-[11px] text-zinc-400">
                {item.meta}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- part to whole ----------------------------------------------------------

/** One bar split into its parts. Segments are separated by a 2px surface gap,
 *  never a stroke, and every segment is named and valued underneath. */
export function StackedBar({
  segments,
  format = identityFormat,
  emptyLabel = "Nothing recorded in this period.",
}: {
  segments: { label: string; value: number; color: string }[];
  format?: Formatter;
  emptyLabel?: string;
}) {
  const present = segments.filter((s) => s.value > 0);
  const total = present.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return <ChartEmpty>{emptyLabel}</ChartEmpty>;

  return (
    <div>
      <div className="flex h-6 w-full gap-[2px]">
        {present.map((s) => (
          <div
            key={s.label}
            tabIndex={0}
            title={`${s.label}: ${format(s.value)}`}
            aria-label={`${s.label}: ${format(s.value)}, ${Math.round((s.value / total) * 100)} percent`}
            className="h-full first:rounded-l-md last:rounded-r-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="flex-1 truncate text-zinc-600">{s.label}</span>
            <span className="tabular-nums text-zinc-400">
              {Math.round((s.value / total) * 100)}%
            </span>
            <span className="w-24 text-right font-medium tabular-nums text-zinc-900">
              {format(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ordered stages, widest first — the ordinal ramp carries the sequence, and
 *  each row shows what share of the previous stage made it through. */
export function Funnel({
  stages,
  format = identityFormat,
}: {
  stages: { label: string; value: number }[];
  format?: Formatter;
}) {
  const top = stages[0]?.value ?? 0;
  if (top <= 0) return <ChartEmpty>No visits in this period.</ChartEmpty>;

  return (
    <ol className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-zinc-600">{s.label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-zinc-900">{format(s.value)}</span>
                {prev !== null && (
                  <span className="ml-1.5 text-zinc-400">
                    {prev > 0 ? `${Math.round((s.value / prev) * 100)}%` : "—"}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full rounded-sm bg-zinc-100">
              <div
                className="h-full rounded-r-sm transition-[width] duration-500"
                style={{
                  width: `${s.value > 0 ? Math.max(2, (s.value / top) * 100) : 0}%`,
                  background: ORDINAL_TEAL[Math.min(i, ORDINAL_TEAL.length - 1)],
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- heatmap ----------------------------------------------------------------

/** Magnitude over a grid — one hue, more is darker, with a scale legend. */
export function Heatmap({
  columns,
  rows,
  format = identityFormat,
  unitLabel,
}: {
  columns: string[];
  rows: { label: string; values: number[] }[];
  format?: Formatter;
  unitLabel: string;
}) {
  const peak = Math.max(0, ...rows.flatMap((r) => r.values));
  if (peak === 0)
    return <ChartEmpty>No check-ins recorded in this period.</ChartEmpty>;

  const max = peak;
  const stepFor = (v: number) => {
    if (v <= 0) return SEQUENTIAL_TEAL[0];
    const i = Math.ceil((v / max) * (SEQUENTIAL_TEAL.length - 1));
    return SEQUENTIAL_TEAL[Math.min(SEQUENTIAL_TEAL.length - 1, Math.max(1, i))];
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[420px] gap-[2px]"
          style={{
            gridTemplateColumns: `2.75rem repeat(${columns.length}, minmax(0,1fr))`,
          }}
        >
          <div />
          {columns.map((c) => (
            <div key={c} className="pb-1 text-center text-[10px] text-zinc-400">
              {c}
            </div>
          ))}
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <div className="flex items-center pr-2 text-[10px] text-zinc-500">
                {row.label}
              </div>
              {row.values.map((v, i) => (
                <div
                  key={columns[i]}
                  tabIndex={0}
                  title={`${row.label} ${columns[i]} — ${format(v)} ${unitLabel}`}
                  aria-label={`${row.label} ${columns[i]}, ${format(v)} ${unitLabel}`}
                  className="h-6 rounded-[3px] transition-transform hover:scale-[1.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700"
                  style={{ background: stepFor(v) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
        <span>0</span>
        <div className="flex gap-[2px]">
          {SEQUENTIAL_TEAL.map((c) => (
            <span
              key={c}
              aria-hidden
              className="h-2.5 w-5 rounded-[2px]"
              style={{ background: c }}
            />
          ))}
        </div>
        <span>
          {format(max)} {unitLabel}
        </span>
      </div>
    </div>
  );
}

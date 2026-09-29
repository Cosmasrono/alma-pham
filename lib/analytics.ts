// Shared analytics helpers — the period model behind the dashboard and the
// admin reports. Pure functions with no React and no storage access, so both
// pages compute their numbers from exactly the same definitions.

import type { Visit } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Preset = "today" | "7d" | "30d" | "month" | "all" | "custom";

export interface Range {
  from: number;
  to: number;
}

/** The [from, to) window a preset (or the custom inputs) resolves to. */
export function resolveRange(
  preset: Preset,
  fromInput: string,
  toInput: string,
): Range {
  const now = new Date();
  const endOfToday =
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY_MS;

  switch (preset) {
    case "today":
      return { from: endOfToday - DAY_MS, to: endOfToday };
    case "7d":
      return { from: endOfToday - 7 * DAY_MS, to: endOfToday };
    case "30d":
      return { from: endOfToday - 30 * DAY_MS, to: endOfToday };
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        to: endOfToday,
      };
    case "custom": {
      const from = fromInput ? new Date(`${fromInput}T00:00:00`).getTime() : 0;
      const to = toInput
        ? new Date(`${toInput}T00:00:00`).getTime() + DAY_MS
        : endOfToday;
      return {
        from: Number.isNaN(from) ? 0 : from,
        to: Number.isNaN(to) ? endOfToday : to,
      };
    }
    default:
      return { from: 0, to: endOfToday };
  }
}

export function rangeLabel(preset: Preset, from: number, to: number): string {
  if (preset === "all") return "All Time (Cumulative)";
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return `${fmt(from)} – ${fmt(to - 1)}`;
}

/** The window of the same length immediately before this one — what a delta
 *  compares against. Meaningless for "all time", so callers skip it there. */
export function previousRange({ from, to }: Range): Range {
  const span = Math.max(DAY_MS, to - from);
  return { from: from - span, to: from };
}

/** Total time in clinic for a completed visit, from its timeline. */
export function visitDurationMs(v: Visit): number | null {
  const t = v.timeline;
  if (!t || t.length < 2) return null;
  const done = t.find((e) => e.status === "completed");
  if (!done) return null;
  return new Date(done.at).getTime() - new Date(t[0].at).getTime();
}

export const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

/** Compact form for stat tiles — 1,284 / 12.9K / 4.2M. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `KSh ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `KSh ${(n / 1_000).toFixed(1)}K`;
  return money(n);
}

/** Percentage change, or null when there is no base to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// --- time buckets -----------------------------------------------------------

export type BucketUnit = "day" | "week" | "month";

export interface Bucket {
  /** Start of the bucket, inclusive. */
  from: number;
  /** End of the bucket, exclusive. */
  to: number;
  /** Short axis label, e.g. "4 Sep". */
  label: string;
  /** Full label for tooltips, e.g. "Thu, 4 Sep 2026". */
  full: string;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  // Monday-first weeks — how clinic staff read a roster.
  const back = (d.getDay() + 6) % 7;
  return d.getTime() - back * DAY_MS;
}

/** How finely to slice a window so a trend line stays readable: days for up to
 *  ~6 weeks, weeks for up to ~15 months, months beyond that. */
export function bucketUnitFor({ from, to }: Range): BucketUnit {
  const days = (to - from) / DAY_MS;
  if (days <= 45) return "day";
  if (days <= 450) return "week";
  return "month";
}

/** Slice a window into consecutive buckets, oldest first. */
export function buildBuckets(range: Range, unit: BucketUnit): Bucket[] {
  const buckets: Bucket[] = [];
  if (!(range.to > range.from)) return buckets;

  let cursor =
    unit === "day"
      ? startOfDay(range.from)
      : unit === "week"
        ? startOfWeek(range.from)
        : new Date(
            new Date(range.from).getFullYear(),
            new Date(range.from).getMonth(),
            1,
          ).getTime();

  // A very old "all time" start would otherwise produce thousands of buckets.
  const MAX_BUCKETS = 400;
  while (cursor < range.to && buckets.length < MAX_BUCKETS) {
    const start = new Date(cursor);
    const end =
      unit === "day"
        ? cursor + DAY_MS
        : unit === "week"
          ? cursor + 7 * DAY_MS
          : new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();

    buckets.push({
      from: cursor,
      to: end,
      label:
        unit === "month"
          ? start.toLocaleDateString("en-KE", { month: "short", year: "2-digit" })
          : start.toLocaleDateString("en-KE", { day: "numeric", month: "short" }),
      full:
        unit === "day"
          ? start.toLocaleDateString("en-KE", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : unit === "week"
            ? `Week of ${start.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`
            : start.toLocaleDateString("en-KE", { month: "long", year: "numeric" }),
    });
    cursor = end;
  }
  return buckets;
}

/** Index of the bucket a timestamp falls in, or -1 when it is outside them. */
export function bucketIndex(buckets: Bucket[], ms: number): number {
  // Buckets are contiguous and ordered, so a binary search keeps this O(log n)
  // even when a year of daily buckets is scanned once per payment.
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ms < buckets[mid].from) hi = mid - 1;
    else if (ms >= buckets[mid].to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

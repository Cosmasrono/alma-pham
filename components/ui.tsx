import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderIcon } from "lucide-react";
import type { OrderStatus, Priority } from "@/lib/types";
import {
  LOCATION_LABELS,
  LONG_STAY_MS,
  VERY_LONG_STAY_MS,
  formatDuration,
  type VisitLocation,
  type VisitTiming,
} from "@/lib/selectors";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Spinner({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <LoaderIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
  const sizes = { sm: "min-h-9 px-3.5 py-1.5 text-sm", md: "min-h-11 px-5 py-2.5 text-sm" };
  const variants = {
    primary:
      "bg-teal-700 text-white shadow-sm shadow-teal-950/20 hover:bg-teal-800",
    secondary:
      "bg-white text-zinc-800 border border-zinc-200 shadow-sm hover:border-teal-700/30 hover:bg-teal-50/60 hover:text-teal-900",
    ghost: "text-zinc-600 hover:bg-teal-900/5 hover:text-teal-900",
    danger:
      "bg-red-600 text-white shadow-sm shadow-red-900/20 hover:bg-red-700",
  };
  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_2px_6px_-2px_rgb(4_47_43/0.06)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm shadow-teal-950/[0.03] placeholder:text-zinc-400 transition-colors focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-teal-900/20 bg-white/70 p-10 text-center text-sm text-zinc-500">
      <span
        aria-hidden
        className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-teal-50 text-base text-teal-700"
      >
        ✚
      </span>
      {children}
    </div>
  );
}

const badgeBase =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

function BadgeDot() {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60"
    />
  );
}

const locationStyle: Record<VisitLocation, string> = {
  reception: "bg-amber-50 text-amber-800 ring-amber-600/20",
  consultation: "bg-sky-50 text-sky-800 ring-sky-600/20",
  lab: "bg-purple-50 text-purple-800 ring-purple-600/20",
  radiology: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  procedure: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-600/20",
  pharmacy: "bg-teal-50 text-teal-800 ring-teal-600/25",
  completed: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
};

const orderStatusStyle: Record<OrderStatus, string> = {
  requested: "bg-amber-50 text-amber-800 ring-amber-600/20",
  "in-progress": "bg-sky-50 text-sky-800 ring-sky-600/20",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

const priorityStyle: Record<Priority, string> = {
  normal: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
  urgent: "bg-orange-50 text-orange-800 ring-orange-600/25",
  emergency: "bg-red-50 text-red-700 ring-red-600/25",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={cn(badgeBase, "capitalize", priorityStyle[priority])}>
      <BadgeDot />
      {priority}
    </span>
  );
}

/** Which department the patient is in — the "status" staff care about. */
export function LocationBadge({ location }: { location: VisitLocation }) {
  return (
    <span className={cn(badgeBase, locationStyle[location])}>
      <BadgeDot />
      {LOCATION_LABELS[location]}
    </span>
  );
}

/** How long the patient has been in the clinic (reception → now/completed).
 *  Quiet while the visit moves at a normal pace; amber past 1 hour and red
 *  past 2 so slow-moving patients stand out at a glance. */
export function StayBadge({ timing }: { timing: VisitTiming }) {
  const style = timing.done
    ? "bg-zinc-100 text-zinc-600 ring-zinc-500/20"
    : timing.totalMs >= VERY_LONG_STAY_MS
      ? "bg-red-50 text-red-700 ring-red-600/25"
      : timing.totalMs >= LONG_STAY_MS
        ? "bg-amber-50 text-amber-800 ring-amber-600/25"
        : "bg-zinc-50 text-zinc-500 ring-zinc-500/15";
  return (
    <span
      className={cn(badgeBase, "tabular-nums", style)}
      title={
        timing.done
          ? "Total time in clinic"
          : `In clinic ${formatDuration(timing.totalMs)} · at this stage ${formatDuration(timing.stageMs)}`
      }
    >
      <span aria-hidden>⏱</span>
      {formatDuration(timing.totalMs)}
      {!timing.done && timing.totalMs >= LONG_STAY_MS && " in clinic"}
    </span>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cn(badgeBase, "capitalize", orderStatusStyle[status])}>
      <BadgeDot />
      {status.replace(/-/g, " ")}
    </span>
  );
}

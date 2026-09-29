import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderIcon } from "lucide-react";
import { Button as BaseButton } from "./ui/button";
import { cn } from "@/lib/utils";
export { cn } from "@/lib/utils";
import type { OrderStatus, Priority } from "@/lib/types";
import {
  LOCATION_LABELS,
  LONG_STAY_MS,
  VERY_LONG_STAY_MS,
  formatDuration,
  type VisitLocation,
  type VisitTiming,
} from "@/lib/selectors";

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
  const variants = { primary: "default", secondary: "outline", ghost: "ghost", danger: "destructive" } as const;
  return (
    <BaseButton
      variant={variants[variant]}
      size={size === "md" ? "default" : "sm"}
      className={className}
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
        "rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm",
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
      <span className="font-medium text-foreground/85">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-teal-900/20 bg-card/70 p-10 text-center text-sm text-muted-foreground dark:border-teal-500/25">
      <span
        aria-hidden
        className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-teal-50 text-base text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
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
  reception: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-500/30",
  consultation: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-500/30",
  lab: "bg-purple-50 text-purple-800 ring-purple-600/20 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-500/30",
  radiology: "bg-indigo-50 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-500/30",
  procedure: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-600/20 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:ring-fuchsia-500/30",
  pharmacy: "bg-teal-50 text-teal-800 ring-teal-600/25 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-500/30",
  completed: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
};

const orderStatusStyle: Record<OrderStatus, string> = {
  requested: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-500/30",
  "in-progress": "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-500/30",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-500/30",
};

const priorityStyle: Record<Priority, string> = {
  normal: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  urgent: "bg-orange-50 text-orange-800 ring-orange-600/25 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-500/30",
  emergency: "bg-red-50 text-red-700 ring-red-600/25 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-500/30",
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
    ? "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
    : timing.totalMs >= VERY_LONG_STAY_MS
      ? "bg-red-50 text-red-700 ring-red-600/25 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-500/30"
      : timing.totalMs >= LONG_STAY_MS
        ? "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-500/30"
        : "bg-zinc-50 text-zinc-500 ring-zinc-500/15 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-700/50";
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

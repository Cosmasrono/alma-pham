import { cn } from "./ui";

/** Amla - Medicare Ltd mark: the figure from the client's logo, set on a
 *  white tile so the blue and green stay legible on the dark teal chrome.
 *  The full logo (with wordmark) lives at /brand/amla-logo.png. */
export function BrandLogo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "h-8 w-8", md: "h-9 w-9", lg: "h-10 w-10" };

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[11px] bg-white p-0.5 ring-1 ring-black/5",
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static mark */}
      <img src="/brand/amla-mark.png" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

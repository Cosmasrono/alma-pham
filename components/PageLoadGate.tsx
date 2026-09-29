"use client";

import { Spinner } from "./ui";

/** Non-blocking feedback while the next route renders, preserving context. */
export function RouteLoadingOverlay() {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-5 top-4 z-90 flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-medium text-teal-900 shadow-lg print:hidden">
      <Spinner aria-hidden="true" />
      Loading workspace…
    </div>
  );
}

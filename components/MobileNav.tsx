"use client";

import { useEffect, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

/** Hamburger menu for the landing page on phones, where the header links are
 *  hidden for space. Closes after a link is tapped or on Escape. */
export function MobileNav({ links }: { links: [href: string, label: string][] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-teal-950/10 text-teal-900 transition-colors hover:bg-teal-50"
      >
        {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
      </button>
      {open && (
        <nav
          id="mobile-nav"
          className="absolute inset-x-0 top-full border-b border-teal-950/10 bg-white px-4 pb-3 shadow-lg shadow-teal-950/5"
        >
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block border-b border-teal-950/5 py-3 text-base font-medium text-zinc-700 last:border-0 hover:text-teal-700"
            >
              {label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

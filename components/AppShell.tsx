"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "./ui";
import { useSession } from "./SessionProvider";
import {
  ROLE_LABELS,
  sectionForPath,
  sectionsForRole,
  type NavSection,
} from "@/lib/auth/roles";
import { RouteLoadingOverlay } from "./PageLoadGate";
import { AiAssistant } from "./AiAssistant";
import { BrandLogo } from "./BrandLogo";
import { BranchSwitcher } from "./BranchSwitcher";
import { MenuIcon, XIcon, LayoutDashboard, Store, Sparkles, Hospital, Users, Wallet, Settings, CalendarDays, Stethoscope, FlaskConical, Pill, Package, ArrowLeftRight, Building2, ChartNoAxesCombined, ClipboardList, UserPlus, ShieldCheck, ScrollText, ReceiptText, type LucideIcon } from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  developer: ShieldCheck, "/developer": ShieldCheck,
  dashboard: LayoutDashboard, "walk-in": Store, inventory: Package,
  stations: Hospital, patients: Users, money: Wallet, setup: Settings,
  activity: CalendarDays, "/dashboard": LayoutDashboard, "/walk-in": Store,
  "/ai-insights": Sparkles, "/reception": UserPlus, "/doctor": Stethoscope,
  "/services": FlaskConical, "/pharmacy": Pill, "/reports": ChartNoAxesCombined, "/sales": ReceiptText,
  "/flow": ArrowLeftRight, "/patients": Users, "/activity": CalendarDays,
  "/admin/medicines": Package, "/admin/transfers": ArrowLeftRight, "/admin/stock-log": ScrollText,
  "/admin/branches": Building2, "/admin/services": FlaskConical,
  "/admin/accounting": Wallet, "/admin/reconciliation": ClipboardList,
  "/admin/users": Users, "/admin/settings": Settings,
};

function NavIcon({ name }: { name: string }) {
  const Icon = NAV_ICONS[name] ?? ClipboardList;
  return <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.8} />;
}

/** A section holding a single page is shown as that page — "Reception" reads
 *  better than "Stations" for staff who only ever see the one station. */
function sectionFace(section: NavSection): { label: string; icon: string } {
  const only = section.items.length === 1 ? section.items[0] : null;
  return only
    ? { label: only.label, icon: only.icon }
    : { label: section.label, icon: section.icon };
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return <BrandLogo size={size} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const session = useSession();

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(mobileMenuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => { if (window.innerWidth >= 768) setMobileMenuOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      previousFocus?.focus();
    };
  }, [mobileMenuOpen]);

  if (pathname === "/" || pathname === "/login" || !session) {
    return <>{children}</>;
  }

  const sections = sectionsForRole(session.role);
  const current = sectionForPath(sections, pathname);

  // Push inside a transition so `navigating` stays true exactly as long as
  // the next route takes to render — that drives the loading overlay.
  function navigate(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return; // let the browser handle new-tab/window clicks
    }
    e.preventDefault();
    setMobileMenuOpen(false);
    if (href === pathname) return;
    startNavigation(() => router.push(href));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
    {navigating && <RouteLoadingOverlay />}
    <div className="workspace flex min-h-screen bg-transparent text-zinc-900">
      <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto bg-teal-950 p-4 text-teal-50 md:flex xl:w-60 print:!hidden">
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <BrandMark />
          <div>
            <p className="font-display text-base font-semibold leading-tight text-white">
              Amla Medicare
            </p>
            <p className="text-xs text-teal-300/80">Clinic Management</p>
          </div>
        </div>
        <BranchSwitcher className="mb-3" />
        <nav className="flex flex-1 flex-col gap-1">
          {sections.map((section) => {
            const active = current?.key === section.key;
            // A section link lands on its first page; the tab bar takes over
            // from there.
            const href = section.items[0].href;
            const face = sectionFace(section);
            return (
              <Link
                key={section.key}
                href={href}
                onClick={(e) => navigate(e, href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  section.key === "developer" && "mt-auto",
                  active
                    ? "bg-white/10 text-white shadow-inner shadow-white/5 ring-1 ring-inset ring-white/10"
                    : "text-teal-200/75 hover:bg-white/5 hover:text-white",
                )}
              >
                <NavIcon name={section.items.length === 1 ? href : section.key} />
                {face.label}
              </Link>
            );
          })}
        </nav>

        <UserBox
          name={session.name}
          roleLabel={ROLE_LABELS[session.role]}
          onLogout={logout}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-teal-950 px-4 py-2.5 text-white md:hidden print:!hidden">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span className="font-display font-semibold">Amla Medicare</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileMenuOpen}
            className="grid size-10 place-items-center rounded-xl text-teal-100 hover:bg-white/10"
          >
            <MenuIcon className="size-5" />
          </button>
        </header>

        <main id="workspace-content" tabIndex={-1} aria-busy={navigating} className="relative min-w-0 flex-1">
          <div className="relative mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:p-8">
            {current && (
              <SectionTabs
                section={current}
                pathname={pathname}
                onNavigate={navigate}
              />
            )}
            {children}
          </div>
        </main>
      </div>

      <div className="print:hidden">
        <AiAssistant />
      </div>

      {mobileMenuOpen && (
        <div ref={mobileMenuRef} role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-80 md:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-teal-950/55 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside
            aria-label="Main navigation"
            className="absolute right-0 top-0 flex h-full w-[min(86vw,340px)] flex-col bg-teal-950 p-4 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="font-semibold">{session.name}</p>
                <p className="text-xs text-teal-300">{ROLE_LABELS[session.role]}</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="grid size-10 place-items-center rounded-xl hover:bg-white/10"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <BranchSwitcher className="mt-4" />
            <nav className="mt-4 flex flex-1 flex-col gap-2 overflow-y-auto">
              {sections.map((section) => {
                const active = current?.key === section.key;
                const href = section.items[0].href;
                const face = sectionFace(section);
                return (
                  <Link
                    key={section.key}
                    href={href}
                    onClick={(e) => navigate(e, href)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium",
                      section.key === "developer" && "mt-auto",
                      active ? "bg-white/15 text-white" : "text-teal-100 hover:bg-white/10",
                    )}
                  >
                    <NavIcon name={section.items.length === 1 ? href : section.key} />
                    {face.label}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={logout}
              className="mt-4 min-h-11 rounded-xl border border-white/15 px-4 text-left text-sm font-medium text-teal-100 hover:bg-white/10"
            >
              Sign out
            </button>
          </aside>
        </div>
      )}
    </div>
    </>

  );
}

/** In-page navigation for the section the user is in. Replaces the long flat
 *  sidebar: the sidebar picks the section, these tabs pick the page. Sections
 *  holding a single page (Dashboard, Activity) render nothing. */
function SectionTabs({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  if (section.items.length < 2) return null;

  return (
    <nav aria-label="Section navigation" className="mb-7 flex gap-1 overflow-x-auto border-b border-zinc-200 pb-3 print:hidden">
      {section.items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(e) => onNavigate(e, item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-teal-700 text-white shadow-sm"
                : "text-teal-900/65 hover:bg-teal-900/5 hover:text-teal-900",
            )}
          >
            <NavIcon name={item.href} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBox({
  name,
  roleLabel,
  onLogout,
}: {
  name: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  const [openPin, setOpenPin] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function savePin() {
    if (!/^\d{4}$/.test(pin)) {
      setMessage("PIN must be exactly 4 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setMessage("PINs do not match.");
      return;
    }
    if (!currentPassword) {
      setMessage("Enter your current password.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "set",
          currentPassword,
          pin,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? "Could not save PIN.");
        return;
      }

      setMessage("PIN saved successfully.");
      setCurrentPassword("");
      setPin("");
      setConfirmPin("");
      setOpenPin(false);
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
      <p className="px-1 text-sm font-medium text-white">{name}</p>
      <p className="px-1 text-xs text-teal-300/80">{roleLabel}</p>
      <button
        onClick={() => {
          setOpenPin((v) => !v);
          setMessage(null);
        }}
        className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-teal-200/75 transition-colors hover:bg-white/5 hover:text-white"
      >
        Set 4-digit PIN
      </button>

      {openPin && (
        <div className="mt-2 space-y-2 rounded-lg bg-white/5 p-2 ring-1 ring-inset ring-white/10">
          <input
            className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-xs text-white placeholder:text-teal-200/60 focus:outline-none"
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <input
            className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-center text-xs tracking-[0.3em] text-white placeholder:text-teal-200/60 focus:outline-none"
            placeholder="New PIN"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <input
            className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-center text-xs tracking-[0.3em] text-white placeholder:text-teal-200/60 focus:outline-none"
            placeholder="Confirm PIN"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) =>
              setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
          />
          <button
            onClick={savePin}
            disabled={saving}
            className="w-full rounded-md bg-teal-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save PIN"}
          </button>
        </div>
      )}

      {message && (
        <p className="mt-2 rounded-md bg-white/10 px-2 py-1.5 text-xs text-teal-100">
          {message}
        </p>
      )}

      <button
        onClick={onLogout}
        className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-teal-200/75 transition-colors hover:bg-white/5 hover:text-white"
      >
        Sign out
      </button>
    </div>
  );
}

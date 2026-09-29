// Roles, the per-role navigation, and access rules. Pure data — safe to import
// on the client (no crypto / no server-only APIs).

import { BRANCHES_ENABLED, BRANCH_PAGES } from "@/lib/features";

export type Role =
  | "admin"
  | "receptionist"
  | "nurse"
  | "doctor"
  | "lab"
  | "radiology"
  | "pharmacist"
  // The software vendor's support account. Not a clinic user: it signs in with
  // credentials from the server's .env, sees every page and branch, and can't
  // change clinic data — only switch the system, branches and accounts on/off.
  | "developer";

export type Permission =
  | "users.manage"
  | "mpesa.initiate"
  | "activity.view_all"
  | "activity.review"
  | "ai.admin_insights"
  | "clinic.mutate.all"
  | "clinic.reception.manage"
  | "clinic.doctor.manage"
  | "clinic.services.manage"
  | "clinic.pharmacy.manage"
  | "clinic.medicine.manage"
  | "clinic.catalog.manage"
  | "clinic.payments.take"
  | "clinic.finance.manage";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
}

/** Roles a clinic admin can give a staff account. "developer" is deliberately
 *  absent — that account comes from the server's configuration only. */
export const ROLES: Role[] = [
  "admin",
  "receptionist",
  "nurse",
  "doctor",
  "lab",
  "radiology",
  "pharmacist",
];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  receptionist: "Receptionist",
  nurse: "Nurse (Triage)",
  doctor: "Doctor",
  lab: "Lab technician",
  radiology: "Radiology technician",
  pharmacist: "Pharmacist",
  developer: "Developer (view only)",
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "users.manage",
    "mpesa.initiate",
    "activity.view_all",
    "activity.review",
    "ai.admin_insights",
    "clinic.mutate.all",
    "clinic.reception.manage",
    "clinic.doctor.manage",
    "clinic.services.manage",
    "clinic.pharmacy.manage",
    "clinic.medicine.manage",
    "clinic.catalog.manage",
    "clinic.payments.take",
    "clinic.finance.manage",
  ],
  // Reception is the cashier for the consultation and service pay-gates.
  receptionist: ["clinic.reception.manage", "clinic.payments.take"],
  nurse: ["clinic.reception.manage"],
  doctor: ["clinic.doctor.manage"],
  lab: ["clinic.services.manage"],
  radiology: ["clinic.services.manage"],
  pharmacist: [
    "mpesa.initiate",
    "clinic.pharmacy.manage",
    "clinic.medicine.manage",
    "clinic.payments.take",
  ],
  // No write permission at all — see canView() for what it may read.
  developer: [],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** May this role *read* what the permission guards? The developer reads
 *  everything and changes nothing; everyone else reads what they may manage. */
export function canView(role: Role, permission: Permission): boolean {
  return role === "developer" || hasPermission(role, permission);
}

export const isDeveloper = (role: Role) => role === "developer";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
}

// A station is visible to its role(s) and to admins. Reception/triage staff
// see only their own station (it has its own patient-status overview).
export const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "▦",
    // Admin-only: it shows a live overview of every station, so exposing it
    // to station staff would leak the other stations' work.
    roles: ["admin"],
  },
  {
    // The developer's view of the whole system — branches, accounts, money,
    // alerts — and the only switches it may flip: system, branch and account
    // on/off. Clinic admins never see it.
    href: "/developer",
    label: "Developer console",
    icon: "🛡️",
    roles: ["developer"],
  },
  {
    // Over-the-counter sales to customers who never enter the clinic process.
    href: "/walk-in",
    label: "Walk-in counter",
    icon: "🏪",
    roles: ["pharmacist", "admin"],
  },
  {
    // Demand forecast, reorder advice, stockout and expiry risk.
    href: "/ai-insights",
    label: "AI insights",
    icon: "✨",
    roles: ["pharmacist", "admin"],
  },
  {
    href: "/reception",
    label: "Reception",
    icon: "➕",
    roles: ["receptionist", "nurse", "admin"],
  },
  {
    href: "/doctor",
    label: "Consultation",
    icon: "🩺",
    roles: ["doctor", "admin"],
  },
  {
    href: "/services",
    label: "Lab / Procedure",
    icon: "🔬",
    roles: ["lab", "radiology", "admin"],
  },
  {
    href: "/pharmacy",
    label: "Pharmacy",
    icon: "💊",
    roles: ["pharmacist", "admin"],
  },
  {
    // Every medicine sale, marked walk-in (community) or clinic (in-house).
    href: "/sales",
    label: "Sales",
    icon: "🧾",
    roles: ["pharmacist", "admin"],
  },
  {
    // Revenue, throughput and pharmacy reports over any period.
    href: "/reports",
    label: "Reports",
    icon: "📊",
    roles: ["admin"],
  },
  {
    // The live board: every staff member sees all patients' statuses and
    // times from reception to completion, long-stayers highlighted.
    href: "/flow",
    label: "Patient flow",
    icon: "⏱️",
    roles: ROLES,
  },
  {
    href: "/patients",
    label: "Patients",
    icon: "👥",
    roles: ["doctor", "admin"],
  },
  {
    // Every staff member files leave / short-excuse requests here; admins
    // also see the approval queue on the same page.
    href: "/activity",
    label: "Activity",
    icon: "🗓️",
    roles: ROLES,
  },
  {
    href: "/admin/medicines",
    label: "Medicines",
    icon: "📦",
    roles: ["pharmacist", "admin"],
  },
  {
    // Move stock between branches; batches keep their expiry.
    href: "/admin/transfers",
    label: "Stock transfers",
    icon: "🔁",
    roles: ["pharmacist", "admin"],
  },
  {
    // The inventory audit trail: every stock/price change, who, where, when.
    href: "/admin/stock-log",
    label: "Stock log",
    icon: "🧾",
    roles: ["pharmacist", "admin"],
  },
  {
    // Clinic locations: each with its own queue, stock and tills.
    href: "/admin/branches",
    label: "Branches",
    icon: "🏢",
    roles: ["admin"],
  },
  {
    // Priced lab / radiology / procedure catalog the doctor orders from.
    href: "/admin/services",
    label: "Service catalog",
    icon: "🔬",
    roles: ["admin"],
  },
  {
    // The accountant's page: expenses, cost of goods sold and P&L.
    href: "/admin/accounting",
    label: "Accounting",
    icon: "💰",
    roles: ["admin"],
  },
  {
    // Daily money check: recorded payments vs counted cash and confirmed M-Pesa.
    href: "/admin/reconciliation",
    label: "Reconciliation",
    icon: "⚖️",
    roles: ["admin"],
  },
  { href: "/admin/users", label: "Users", icon: "⚙️", roles: ["admin"] },
  {
    // Clinic-wide billing mode (pay-per-stage vs pay-at-end) + consultation fee.
    href: "/admin/settings",
    label: "Settings",
    icon: "🛠️",
    roles: ["admin"],
  },
];

export function navForRole(role: Role): NavItem[] {
  // The developer sees every admin page (read-only) plus its own console.
  // Branch pages stay out of the menu while branches are switched off.
  return NAV.filter(
    (n) =>
      (n.roles.includes(role) || (role === "developer" && n.roles.includes("admin"))) &&
      (BRANCHES_ENABLED || !BRANCH_PAGES.includes(n.href)),
  );
}

// --- grouping ---------------------------------------------------------------
// The sidebar shows one entry per section; the pages inside a section are
// reached by a tab bar at the top of the page (rendered by AppShell). NAV above
// stays the flat source of truth for access control — this only groups it.

export interface NavSection {
  key: string;
  label: string;
  icon: string;
  /** Visible pages in tab order. Never empty. */
  items: NavItem[];
}

const SECTION_DEFS: {
  key: string;
  label: string;
  icon: string;
  hrefs: string[];
}[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦", hrefs: ["/dashboard"] },
  // Its own entry right after the dashboard: the counter serves customers who
  // never enter the clinic process, so it isn't one of the patient stations.
  { key: "walk-in", label: "Walk-in counter", icon: "🏪", hrefs: ["/walk-in"] },
  {
    key: "stations",
    label: "Stations",
    icon: "🏥",
    hrefs: ["/reception", "/doctor", "/services", "/pharmacy"],
  },
  {
    key: "patients",
    label: "Patients",
    icon: "👥",
    hrefs: ["/flow", "/patients"],
  },
  {
    key: "money",
    label: "Money",
    icon: "💰",
    hrefs: ["/sales", "/reports", "/admin/accounting", "/admin/reconciliation"],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: "📦",
    hrefs: ["/admin/medicines", "/admin/transfers", "/admin/stock-log", "/ai-insights"],
  },
  {
    key: "setup",
    label: "Setup",
    icon: "🛠️",
    hrefs: [
      "/admin/services",
      "/admin/branches",
      "/admin/users",
      "/admin/settings",
    ],
  },
  { key: "activity", label: "Activity", icon: "🗓️", hrefs: ["/activity"] },
  // The shell anchors the developer console above the account controls.
  { key: "developer", label: "Developer console", icon: "🛡️", hrefs: ["/developer"] },
];

/** Sections this role can see, each already filtered to its allowed pages.
 *  Sections with nothing left in them are dropped. */
export function sectionsForRole(role: Role): NavSection[] {
  const allowed = navForRole(role);
  return SECTION_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    icon: def.icon,
    items: def.hrefs
      .map((href) => allowed.find((n) => n.href === href))
      .filter((n): n is NavItem => Boolean(n)),
  })).filter((section) => section.items.length > 0);
}

/** Which section a path belongs to — drives sidebar highlighting and which
 *  tab bar the page shows. */
export function sectionForPath(
  sections: NavSection[],
  pathname: string,
): NavSection | undefined {
  return sections.find((s) =>
    s.items.some(
      (n) => pathname === n.href || pathname.startsWith(n.href + "/"),
    ),
  );
}

const HOME: Record<Role, string> = {
  admin: "/dashboard",
  receptionist: "/reception",
  nurse: "/reception",
  doctor: "/doctor",
  lab: "/services",
  radiology: "/services",
  pharmacist: "/pharmacy",
  developer: "/developer",
};

export function homeForRole(role: Role): string {
  return HOME[role] ?? "/";
}

/** Can this role open this page path? Admins can open any clinic page; the
 *  developer can open every page (read-only — its writes are refused). */
export function canAccess(role: Role, pathname: string): boolean {
  if (role === "developer") return true;
  const item = NAV.find(
    (n) =>
      pathname === n.href ||
      (n.href !== "/" && pathname.startsWith(n.href + "/")),
  );
  if (item?.roles.length === 1 && item.roles[0] === "developer") return false;
  if (role === "admin") return true;
  if (!item) return false; // unknown protected path → deny
  return item.roles.includes(role);
}

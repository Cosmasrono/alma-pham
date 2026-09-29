

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/roles";
import type { Branch, ID } from "@/lib/types";
import { BRANCHES_ENABLED } from "@/lib/features";

export const BRANCH_COOKIE = "cp_branch";
export const ALL_BRANCHES = "all";

type BranchRow = Awaited<ReturnType<typeof prisma.branch.findFirstOrThrow>>;

export function mapBranch(b: BranchRow): Branch {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    address: b.address ?? undefined,
    phone: b.phone ?? undefined,
    isMain: b.isMain,
    active: b.active,
  };
}

/** Records written before branches existed have no branchId at all (not
 *  even null) — MongoDB treats "missing" and "null" as different. */
const unassigned = { OR: [{ branchId: null }, { branchId: { isSet: false } }] };

let setup: Promise<ID> | null = null;

/** Make sure a main branch exists and that everything recorded before
 *  branches existed belongs to it. Idempotent; runs once per server process.
 *  Returns the main branch id. */
export function ensureBranchSetup(): Promise<ID> {
  if (!setup) {
    setup = migrate().catch((err) => {
      setup = null; // let the next request retry
      throw err;
    });
  }
  return setup;
}

async function migrate(): Promise<ID> {
  // A dev server started before `prisma generate` keeps its old client (it is
  // cached across hot reloads), which has no branch table at all.
  if (!(prisma as unknown as { branch?: unknown }).branch) {
    throw new Error(
      "The database client is out of date. Stop the dev server, run `pnpm prisma generate`, then start it again.",
    );
  }
  let main = await prisma.branch.findFirst({ where: { isMain: true } });
  if (!main) {
    const any = await prisma.branch.findFirst({ orderBy: { createdAt: "asc" } });
    main = any
      ? await prisma.branch.update({ where: { id: any.id }, data: { isMain: true } })
      : await prisma.branch.create({
          data: { name: "Main branch", code: "MAIN", isMain: true },
        });
  }
  const mainId = main.id;

  // Everything that predates branches happened at the main branch.
  await Promise.all([
    prisma.visit.updateMany({ where: unassigned, data: { branchId: mainId } }),
    prisma.order.updateMany({ where: unassigned, data: { branchId: mainId } }),
    prisma.medicineBatch.updateMany({ where: unassigned, data: { branchId: mainId } }),
    prisma.shift.updateMany({ where: unassigned, data: { branchId: mainId } }),
  ]);

  // Stock counted before branches is the main branch's stock.
  const [medicines, counted] = await Promise.all([
    prisma.medicine.findMany({ select: { id: true, stock: true } }),
    prisma.medicineStock.findMany({ select: { medicineId: true } }),
  ]);
  const hasRow = new Set(counted.map((c) => c.medicineId));
  const missing = medicines.filter((m) => !hasRow.has(m.id));
  if (missing.length > 0) {
    await prisma.medicineStock.createMany({
      data: missing.map((m) => ({ medicineId: m.id, branchId: mainId, quantity: m.stock })),
    });
  }
  return mainId;
}

export interface BranchContext {
  /** Branch whose data the screens show; null = every branch (admins). */
  viewBranchId: ID | null;
  /** Branch new records are written to. Always concrete. */
  writeBranchId: ID;
  mainBranchId: ID;
  /** Admins may switch branches; everyone else is fixed to their own. */
  canSwitch: boolean;
}

/** Which branch is this request for? */
export async function branchContext(session: SessionUser): Promise<BranchContext> {
  const mainBranchId = await ensureBranchSetup();
  // Branch screens hidden: everyone works in the main branch, so nobody can
  // end up stuck in a branch (or "all branches") they have no way to leave.
  if (!BRANCHES_ENABLED) {
    return { viewBranchId: mainBranchId, writeBranchId: mainBranchId, mainBranchId, canSwitch: false };
  }
  const [user, active] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id }, select: { branchId: true } }),
    prisma.branch.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const activeIds = new Set(active.map((b) => b.id));

  // Admins and the developer can look across branches; everyone else can't.
  if (session.role !== "admin" && session.role !== "developer") {
    // Staff always work at their own branch (main when none was assigned, or
    // theirs was closed).
    const own = user?.branchId && activeIds.has(user.branchId) ? user.branchId : mainBranchId;
    return { viewBranchId: own, writeBranchId: own, mainBranchId, canSwitch: false };
  }

  // A single-site clinic has nothing to choose between: "all" is that branch.
  if (activeIds.size <= 1) {
    return { viewBranchId: mainBranchId, writeBranchId: mainBranchId, mainBranchId, canSwitch: true };
  }

  // Admins: the branch picked in the switcher, else their own, else all.
  const picked = (await cookies()).get(BRANCH_COOKIE)?.value;
  let view: ID | null;
  if (picked === ALL_BRANCHES) view = null;
  else if (picked && activeIds.has(picked)) view = picked;
  else view = user?.branchId && activeIds.has(user.branchId) ? user.branchId : null;
  return {
    viewBranchId: view,
    writeBranchId: view ?? mainBranchId,
    mainBranchId,
    canSwitch: true,
  };
}

export async function listBranches(): Promise<Branch[]> {
  await ensureBranchSetup();
  const rows = await prisma.branch.findMany({
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });
  return rows.map(mapBranch);
}

const cleanCode = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);

export async function createBranch(input: {
  name: string;
  code: string;
  address?: string;
  phone?: string;
}): Promise<{ error: string } | { branch: Branch }> {
  await ensureBranchSetup();
  const name = String(input.name ?? "").trim();
  const code = cleanCode(input.code);
  if (!name || !code) return { error: "Name and code are required." };
  const clash = await prisma.branch.findFirst({
    where: { OR: [{ name: { equals: name, mode: "insensitive" } }, { code }] },
  });
  if (clash) return { error: "A branch with that name or code already exists." };
  const branch = await prisma.branch.create({
    data: {
      name,
      code,
      address: String(input.address ?? "").trim() || null,
      phone: String(input.phone ?? "").trim() || null,
    },
  });
  return { branch: mapBranch(branch) };
}

export async function updateBranch(input: {
  id: ID;
  name?: string;
  code?: string;
  address?: string;
  phone?: string;
  active?: boolean;
  isMain?: boolean;
}): Promise<{ error: string } | { branch: Branch }> {
  const branch = await prisma.branch.findUnique({ where: { id: input.id } });
  if (!branch) return { error: "Branch not found." };

  const data: {
    name?: string;
    code?: string;
    address?: string | null;
    phone?: string | null;
    active?: boolean;
    isMain?: boolean;
  } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "Name cannot be blank." };
    data.name = name;
  }
  if (input.code !== undefined) {
    const code = cleanCode(input.code);
    if (!code) return { error: "Code cannot be blank." };
    data.code = code;
  }
  if (input.address !== undefined) data.address = input.address.trim() || null;
  if (input.phone !== undefined) data.phone = input.phone.trim() || null;
  if (input.active === false && branch.isMain) {
    return { error: "The main branch can't be closed — make another branch main first." };
  }
  if (typeof input.active === "boolean") data.active = input.active;

  if (data.name || data.code) {
    const clash = await prisma.branch.findFirst({
      where: {
        id: { not: branch.id },
        OR: [
          ...(data.name ? [{ name: { equals: data.name, mode: "insensitive" as const } }] : []),
          ...(data.code ? [{ code: data.code }] : []),
        ],
      },
    });
    if (clash) return { error: "Another branch already uses that name or code." };
  }

  if (input.isMain === true && !branch.isMain) {
    if (branch.active === false && data.active !== true) {
      return { error: "Reopen the branch before making it main." };
    }
    // Exactly one main branch.
    await prisma.$transaction([
      prisma.branch.updateMany({ where: { isMain: true }, data: { isMain: false } }),
      prisma.branch.update({ where: { id: branch.id }, data: { ...data, isMain: true } }),
    ]);
    setup = null; // the main-branch id cached for this process has changed
  } else {
    await prisma.branch.update({ where: { id: branch.id }, data });
  }
  const updated = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
  return { branch: mapBranch(updated) };
}

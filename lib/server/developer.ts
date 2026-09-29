 

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/roles";

/** A well-formed ObjectId that no real record will ever have, so any lookup
 *  made with the developer's id quietly finds nothing instead of failing. */
export const DEVELOPER_ID = "000000000000000000000000";

export function developerConfigured(): boolean {
  return Boolean(process.env.DEVELOPER_USERNAME && process.env.DEVELOPER_PASSWORD_HASH);
}

/** The developer session for these credentials, or null. */
export async function developerLogin(identifier: string, password: string): Promise<SessionUser | null> {
  const username = process.env.DEVELOPER_USERNAME?.trim().toLowerCase();
  const encoded = process.env.DEVELOPER_PASSWORD_HASH?.trim();
  if (!username || !encoded || identifier !== username) return null;
  // A raw bcrypt hash ("$2…") is accepted too, for anyone who escaped it.
  const hash = encoded.startsWith("$2") ? encoded : Buffer.from(encoded, "base64").toString("utf8");
  if (!hash.startsWith("$2")) return null; // not a hash we made
  if (!(await verifyPassword(password, hash))) return null;
  return {
    id: DEVELOPER_ID,
    username,
    name: "Developer support",
    role: "developer",
  };
}

// --- the system lock ------------------------------------------------------------

export interface SystemLock {
  locked: boolean;
  message: string | null;
}

// Checked on every API request, so cached briefly; the developer's own switch
// clears the cache so the change is immediate on this server.
let cached: { value: SystemLock; at: number } | null = null;
const CACHE_MS = 15_000;

export async function systemLock(): Promise<SystemLock> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const s = await prisma.clinicSettings.findFirst({
    select: { systemLocked: true, lockMessage: true },
  });
  const value = { locked: s?.systemLocked === true, message: s?.lockMessage ?? null };
  cached = { value, at: Date.now() };
  return value;
}

/** Lock or unlock the system for every clinic account. */
export async function setSystemLock(locked: boolean, message: string | null) {
  const existing = await prisma.clinicSettings.findFirst();
  const data = { systemLocked: locked, lockMessage: message?.trim().slice(0, 300) || null };
  if (existing) await prisma.clinicSettings.update({ where: { id: existing.id }, data });
  else await prisma.clinicSettings.create({ data });
  cached = null;
}

/** The message clinic staff see while the system is locked. */
export function lockMessageFor(lock: SystemLock): string {
  return lock.message?.trim() || "The system is temporarily unavailable. Please contact your system provider.";
}

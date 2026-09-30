 

import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
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

// --- the developer account ------------------------------------------------------
//
// Exactly one. The first person to sign up at /dev-access (linked from the
// sign-in page as "Are you a developer?") becomes the developer, whatever
// their email; the link and signup then close for good, and the developer
// signs in on the normal sign-in page. The account lives apart from clinic
// users, and every session is view-only.

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function cleanEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Is this the developer account's email? Clinic accounts can't use it. */
export async function isDeveloperEmail(raw: unknown): Promise<boolean> {
  const email = cleanEmail(raw);
  return Boolean(email && (await prisma.developerAccount.findUnique({ where: { email } })));
}

/** Developer signup is open only until the one developer account exists. */
export async function developerSignupOpen(): Promise<boolean> {
  return (await prisma.developerAccount.count()) === 0;
}

function developerSession(email: string, name: string): SessionUser {
  return { id: DEVELOPER_ID, username: email, name, role: "developer" };
}

/** Step 1: email a code to the would-be developer. */
export async function startDeveloperSignup(input: {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}): Promise<{ error: string } | { code: string; email: string; name: string }> {
  const name = String(input.name ?? "").trim();
  const email = cleanEmail(input.email);
  const password = String(input.password ?? "");
  if (!name || !email || !password) return { error: "Name, email and password are all required." };
  if (password.length < 12) return { error: "Choose a password of at least 12 characters." };
  if (!(await developerSignupOpen())) return { error: "Developer signup is closed." };
  const recent = await prisma.developerSignup.findUnique({ where: { email } });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_MS) {
    return { error: "A code was just sent. Wait a minute before asking for another." };
  }
  await prisma.developerSignup.deleteMany({ where: { email } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.developerSignup.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      codeHash: await hashPassword(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return { code, email, name };
}

/** Step 2: check the emailed code and create the developer account. */
export async function verifyDeveloperSignup(
  rawEmail: unknown,
  rawCode: unknown,
): Promise<{ error: string } | { session: SessionUser }> {
  const email = cleanEmail(rawEmail);
  const code = String(rawCode ?? "").trim();
  if (!(await developerSignupOpen())) return { error: "Developer signup is closed." };
  const pending = await prisma.developerSignup.findUnique({ where: { email } });
  if (!pending) return { error: "No sign-up is waiting for that email. Please start again." };
  if (pending.expiresAt.getTime() < Date.now() || pending.attempts >= MAX_ATTEMPTS) {
    await prisma.developerSignup.delete({ where: { id: pending.id } });
    return { error: "That code has expired. Please sign up again." };
  }
  if (!/^\d{6}$/.test(code) || !(await verifyPassword(code, pending.codeHash))) {
    await prisma.developerSignup.update({ where: { id: pending.id }, data: { attempts: { increment: 1 } } });
    const left = MAX_ATTEMPTS - pending.attempts - 1;
    return { error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong codes. Please sign up again." };
  }
  return prisma.$transaction(async (tx) => {
    // Claim this exact code once, so two verifications can't both succeed.
    const claim = await tx.developerSignup.deleteMany({
      where: { id: pending.id, codeHash: pending.codeHash, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: new Date() } },
    });
    if (claim.count !== 1) return { error: "This code has already been used or expired. Please start again." };
    // Two signups racing: only one may take the single developer slot.
    if ((await tx.developerAccount.count()) > 0) return { error: "Developer signup is closed." };
    const account = await tx.developerAccount.create({
      data: { email, name: pending.name, passwordHash: pending.passwordHash },
    });
    return { session: developerSession(account.email, account.name) };
  });
}

/** The developer session for these credentials (the account, or .env), or null. */
export async function developerAccountLogin(identifier: unknown, password: unknown): Promise<SessionUser | null> {
  const email = cleanEmail(identifier);
  const pass = String(password ?? "");
  if (!email || !pass) return null;
  const envLogin = await developerLogin(email, pass);
  if (envLogin) return envLogin;
  const account = await prisma.developerAccount.findUnique({ where: { email } });
  if (!account || !(await verifyPassword(pass, account.passwordHash))) return null;
  return developerSession(account.email, account.name);
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

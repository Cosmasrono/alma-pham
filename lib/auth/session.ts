// Server-side session helper for Server Components and route handlers.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./jwt";
import { hasPermission, type Permission, type Role, type SessionUser } from "./roles";

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

/** Throws unless the caller is logged in with one of the allowed roles. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session || (roles.length > 0 && !roles.includes(session.role))) {
    throw new Error("Forbidden");
  }
  return session;
}

/** Throws unless the caller is logged in and has the requested permission. */
export async function requirePermission(
  permission: Permission,
): Promise<SessionUser> {
  const session = await getSession();
  if (!session || !hasPermission(session.role, permission)) {
    throw new Error("Forbidden");
  }
  return session;
}

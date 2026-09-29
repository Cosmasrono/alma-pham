// Sign / verify the session token. Uses `jose` (works in both the Node.js and
// Edge/middleware runtimes) and your AUTH_SECRET from .env. No next/headers
// import here, so this is safe to use from middleware.

import { SignJWT, jwtVerify } from "jose";
import type { Role, SessionUser } from "./roles";

export const SESSION_COOKIE = "clinic_session";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ username: user.username, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.role) return null;
    return {
      id: payload.sub,
      username: payload.username as string,
      name: payload.name as string,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

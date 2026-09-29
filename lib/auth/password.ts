// Password hashing (bcrypt). Node.js runtime only.
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Human-friendly temporary password for accounts created by an admin.
 * Avoids characters that are easy to misread (0/O, 1/l/I) because the
 * password is emailed and usually retyped by hand.
 */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

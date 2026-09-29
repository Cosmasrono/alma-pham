// Prisma client singleton (server-only).
//
// In dev, Next.js hot-reloads modules repeatedly; without the global cache we
// would open a new connection pool on every reload and exhaust the database.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

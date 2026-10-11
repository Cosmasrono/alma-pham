// Configure the clinic owner. Developer signup uses DEVELOPER_EMAIL in .env.
// pnpm exec tsx --env-file=.env scripts/configure-signup.ts --owner owner@client.com
import { prisma } from "../lib/prisma";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1]?.trim().toLowerCase();
}

async function main() {
  const ownerEmail = flag("owner");
  if (!ownerEmail) throw new Error("Provide --owner with an email.");
  if (ownerEmail !== undefined && !EMAIL.test(ownerEmail)) throw new Error("Provide a valid owner email.");
  const settings = await prisma.clinicSettings.findFirst();
  const data = { ownerEmail };
  if (settings) await prisma.clinicSettings.update({ where: { id: settings.id }, data });
  else await prisma.clinicSettings.create({ data });
  if (ownerEmail) console.log(`Owner signup configured for ${ownerEmail}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not configure signup. Check DATABASE_URL and database access.");
  if (error && typeof error === "object" && "code" in error) console.error(`Database error code: ${error.code}`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

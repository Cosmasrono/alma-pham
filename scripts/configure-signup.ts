// Names the client's owner and/or administrator — the only emails that may
// sign up. Run once per installation:
//   pnpm exec tsx --env-file=.env scripts/configure-signup.ts --owner owner@client.com --admin admin@client.com
// Either flag may be omitted; the omitted email is left unchanged.
import { prisma } from "../lib/prisma";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1]?.trim().toLowerCase();
}

async function main() {
  const ownerEmail = flag("owner");
  const adminEmail = flag("admin");
  if (!ownerEmail && !adminEmail) throw new Error("Provide --owner and/or --admin with an email.");
  if (ownerEmail !== undefined && !EMAIL.test(ownerEmail)) throw new Error("Provide a valid owner email.");
  if (adminEmail !== undefined && !EMAIL.test(adminEmail)) throw new Error("Provide a valid administrator email.");
  const settings = await prisma.clinicSettings.findFirst();
  const data = { ...(ownerEmail ? { ownerEmail } : {}), ...(adminEmail ? { adminSignupEmail: adminEmail } : {}) };
  if (settings) await prisma.clinicSettings.update({ where: { id: settings.id }, data });
  else await prisma.clinicSettings.create({ data });
  if (ownerEmail) console.log(`Owner signup configured for ${ownerEmail}.`);
  if (adminEmail) console.log(`Administrator signup configured for ${adminEmail}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not configure signup. Check DATABASE_URL and database access.");
  if (error && typeof error === "object" && "code" in error) console.error(`Database error code: ${error.code}`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

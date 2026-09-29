// Clears the medicine catalog so a fresh supplier list can be imported.
//
//   pnpm exec tsx --env-file=.env scripts/reset-medicines.ts            dry run: counts + backup only
//   pnpm exec tsx --env-file=.env scripts/reset-medicines.ts --confirm  back up, then delete
//
// Deletes: Medicine, MedicineBatch, MedicineStock.
// Keeps: sales, prescriptions, inventory log, transfers — they store the
// medicine name, and screens show "Removed medicine" for the old id.
// Every deleted row is written to backups/ first, and nothing is deleted if
// that backup fails.

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const confirm = process.argv.includes("--confirm");

async function main() {
  const [medicines, batches, stock, openPrescriptions, sales] = await Promise.all([
    prisma.medicine.findMany(),
    prisma.medicineBatch.findMany(),
    prisma.medicineStock.findMany(),
    prisma.order.count({ where: { type: "prescription", status: { not: "completed" } } }),
    prisma.visit.count({ where: { saleItems: { isEmpty: false } } }),
  ]);

  const units = medicines.reduce((s, m) => s + (m.stock ?? 0), 0);
  console.log("Current database:");
  console.log(`  medicines in catalog      ${medicines.length}`);
  console.log(`  units in stock (total)    ${units}`);
  console.log(`  stock batches             ${batches.length}`);
  console.log(`  branch stock rows         ${stock.length}`);
  console.log(`  sales recorded (kept)     ${sales}`);
  console.log(`  prescriptions not yet dispensed  ${openPrescriptions}`);

  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `medicines-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ takenAt: new Date(), medicines, batches, stock }, null, 2));
  console.log(`\nBackup written: ${file}`);

  if (!confirm) {
    console.log("\nDry run — nothing deleted. Re-run with --confirm to clear the catalog.");
    return;
  }
  if (openPrescriptions > 0) {
    console.log(
      `\nWarning: ${openPrescriptions} prescription(s) are still waiting at the pharmacy; ` +
        "they will need to be re-entered against the new catalog.",
    );
  }

  const [b, s, m] = await prisma.$transaction([
    prisma.medicineBatch.deleteMany({}),
    prisma.medicineStock.deleteMany({}),
    prisma.medicine.deleteMany({}),
  ]);
  console.log(`\nDeleted ${m.count} medicines, ${b.count} batches, ${s.count} branch stock rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

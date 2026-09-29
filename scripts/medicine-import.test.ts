import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { importMedicines } from "../lib/server/clinic-repo";

test("import receipts prevent repeated stock writes and roll back failed batches", async () => {
  type Row = { id: string; name: string; strength: string; unitPrice: number; costPrice: number; stock: number };
  type Receipt = { id: string; fingerprint: string; added: number; updated: number };
  let state = { medicines: [] as Row[], receipts: [] as Receipt[], quantity: 0, events: 0 };
  let failAudit = false;
  const original = prisma.$transaction;
  // A transactional in-memory adapter: no connection to the configured database.
  const transaction = async (run: (tx: unknown) => Promise<unknown>) => {
    const next = structuredClone(state);
    const tx = {
      medicineImportReceipt: {
        findUnique: async ({ where }: { where: { id: string } }) => next.receipts.find((r) => r.id === where.id) ?? null,
        create: async ({ data }: { data: Receipt }) => { next.receipts.push(data); return data; },
      },
      medicine: {
        findFirst: async ({ where }: { where: { name: { equals: string }; strength: { equals: string } } }) =>
          next.medicines.find((m) => m.name.toLowerCase() === where.name.equals.toLowerCase() && m.strength.toLowerCase() === where.strength.equals.toLowerCase()) ?? null,
        create: async ({ data }: { data: Omit<Row, "id"> }) => {
          const row = { ...data, id: String(next.medicines.length + 1) };
          next.medicines.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: { stock?: { increment: number }; unitPrice?: number; costPrice?: number } }) => {
          const row = next.medicines.find((m) => m.id === where.id)!;
          if (data.stock) row.stock += data.stock.increment;
          if (data.unitPrice !== undefined) row.unitPrice = data.unitPrice;
          if (data.costPrice !== undefined) row.costPrice = data.costPrice;
          return row;
        },
      },
      medicineStock: {
        upsert: async ({ update }: { update: { quantity: { increment: number } } }) => {
          next.quantity += update.quantity.increment;
          return { quantity: next.quantity };
        },
      },
      inventoryEvent: {
        create: async () => {
          if (failAudit) throw new Error("simulated database failure");
          next.events++;
        },
      },
    };
    const result = await run(tx);
    state = next;
    return result;
  };
  prisma.$transaction = transaction as typeof prisma.$transaction;
  const input = {
    batchId: "session:0",
    branchId: "000000000000000000000001",
    changedById: "000000000000000000000002",
    items: [{ name: "Example", strength: "10mg", form: "tablet", unitPrice: 10, costPrice: 5, stock: 20 }],
  };
  try {
    assert.deepEqual(await importMedicines(input), { added: 1, updated: 0 });
    const saved = structuredClone(state);
    // Simulate losing the HTTP response after the commit, then retrying.
    assert.deepEqual(await importMedicines(input), { added: 1, updated: 0 });
    assert.deepEqual(state, saved);
    assert.ok((await importMedicines({ ...input, items: [{ ...input.items[0], stock: 99 }] })).error);
    assert.deepEqual(state, saved);
    assert.deepEqual(await importMedicines({ ...input, batchId: "session:1", mode: "add_only" }), { added: 0, updated: 0 });
    assert.equal(state.quantity, 20);
    const beforeFailure = structuredClone(state);
    failAudit = true;
    await assert.rejects(importMedicines({ ...input, batchId: "session:2" }), /simulated/);
    assert.deepEqual(state, beforeFailure);
    failAudit = false;
    assert.deepEqual(await importMedicines({ ...input, batchId: "session:2" }), { added: 0, updated: 1 });
    assert.equal(state.quantity, 40);
    assert.equal(state.medicines[0].stock, 40);
    assert.equal(state.events, 2);
    assert.ok((await importMedicines({ ...input, batchId: "invalid", items: [{ ...input.items[0], stock: Infinity }] })).error);
    assert.equal(state.quantity, 40);
  } finally {
    prisma.$transaction = original;
    await prisma.$disconnect();
  }
});

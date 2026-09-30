import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { startAdminSignup, verifyAdminSignup } from "../lib/server/clinic-repo";

test("only owner and approved admin can start signup, even with existing staff", async () => {
  const originals = {
    settings: prisma.clinicSettings.findFirst,
    user: prisma.user.findFirst,
    username: prisma.user.findUnique,
    pending: prisma.adminSignup.findUnique,
    remove: prisma.adminSignup.deleteMany,
    create: prisma.adminSignup.create,
  };
  let approved = "admin@example.com";
  let existing = false;
  const removed: unknown[] = [];
  prisma.clinicSettings.findFirst = (async () => ({ ownerEmail: "owner@client.com", adminSignupEmail: approved })) as typeof prisma.clinicSettings.findFirst;
  prisma.user.findFirst = (async () => existing ? { id: "existing" } : null) as typeof prisma.user.findFirst;
  prisma.user.findUnique = (async () => null) as typeof prisma.user.findUnique;
  prisma.adminSignup.findUnique = (async () => null) as typeof prisma.adminSignup.findUnique;
  prisma.adminSignup.deleteMany = (async (args: unknown) => { removed.push(args); return { count: 0 }; }) as typeof prisma.adminSignup.deleteMany;
  prisma.adminSignup.create = (async () => ({})) as unknown as typeof prisma.adminSignup.create;
  const input = { name: "User", username: "user", password: "secure-password" };
  try {
    assert.ok("error" in await startAdminSignup({ ...input, email: "staff@example.com" }));
    // The vendor's own email is not a client owner, so it cannot sign up.
    assert.ok("error" in await startAdminSignup({ ...input, email: "ccosmas001@gmail.com" }));
    assert.ok("error" in await verifyAdminSignup("staff@example.com", "123456"));
    assert.equal(removed.length, 0);
    assert.ok("code" in await startAdminSignup({ ...input, email: " OWNER@client.com " }));
    assert.ok("code" in await startAdminSignup({ ...input, email: "ADMIN@example.com" }));
    assert.deepEqual(removed, [{ where: { email: "owner@client.com" } }, { where: { email: "admin@example.com" } }]);
    approved = "replacement@example.com";
    assert.ok("error" in await verifyAdminSignup("admin@example.com", "123456"));
    existing = true;
    assert.ok("error" in await startAdminSignup({ ...input, email: "owner@client.com" }));
  } finally {
    prisma.clinicSettings.findFirst = originals.settings;
    prisma.user.findFirst = originals.user;
    prisma.user.findUnique = originals.username;
    prisma.adminSignup.findUnique = originals.pending;
    prisma.adminSignup.deleteMany = originals.remove;
    prisma.adminSignup.create = originals.create;
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { startAdminSignup, verifyAdminSignup } from "../lib/server/clinic-repo";

test("only owner can start signup; administrator and staff cannot self-register", async () => {
  const envOwner = process.env.OWNER_EMAIL;
  const envDeveloper = process.env.DEVELOPER_EMAIL;
  delete process.env.OWNER_EMAIL;
  process.env.DEVELOPER_EMAIL = "developer@example.com";
  const originals = {
    developer: prisma.developerAccount.findUnique,
    settings: prisma.clinicSettings.findFirst,
    user: prisma.user.findFirst,
    username: prisma.user.findUnique,
    pending: prisma.adminSignup.findUnique,
    remove: prisma.adminSignup.deleteMany,
    create: prisma.adminSignup.create,
  };
  prisma.developerAccount.findUnique = (async () => null) as typeof prisma.developerAccount.findUnique;
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
    assert.ok("error" in await startAdminSignup({ ...input, email: "ADMIN@example.com" }));
    assert.deepEqual(removed, [{ where: { email: "owner@client.com" } }]);
    approved = "replacement@example.com";
    assert.ok("error" in await verifyAdminSignup("admin@example.com", "123456"));
    process.env.OWNER_EMAIL = "override@example.com";
    assert.ok("error" in await startAdminSignup({ ...input, email: "owner@client.com" }));
    assert.ok("code" in await startAdminSignup({ ...input, email: "OVERRIDE@example.com" }));
    process.env.OWNER_EMAIL = "developer@example.com";
    assert.ok("error" in await startAdminSignup({ ...input, email: "developer@example.com" }));
    delete process.env.OWNER_EMAIL;
    existing = true;
    assert.ok("error" in await startAdminSignup({ ...input, email: "owner@client.com" }));
  } finally {
    if (envOwner === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = envOwner;
    if (envDeveloper === undefined) delete process.env.DEVELOPER_EMAIL; else process.env.DEVELOPER_EMAIL = envDeveloper;
    prisma.developerAccount.findUnique = originals.developer;
    prisma.clinicSettings.findFirst = originals.settings;
    prisma.user.findFirst = originals.user;
    prisma.user.findUnique = originals.username;
    prisma.adminSignup.findUnique = originals.pending;
    prisma.adminSignup.deleteMany = originals.remove;
    prisma.adminSignup.create = originals.create;
  }
});

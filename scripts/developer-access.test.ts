import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth/password";
import { developerAccountLogin, startDeveloperSignup } from "../lib/server/developer";

test("the first developer signup takes any email, then only DEVELOPER_EMAIL addresses", async () => {
  const env = process.env.DEVELOPER_EMAIL;
  const originals = {
    account: prisma.developerAccount.findUnique,
    count: prisma.developerAccount.count,
    pending: prisma.developerSignup.findUnique,
    remove: prisma.developerSignup.deleteMany,
    create: prisma.developerSignup.create,
  };
  process.env.DEVELOPER_EMAIL = "second@vendor.com";
  let accounts = 0;
  prisma.developerAccount.count = (async () => accounts) as typeof prisma.developerAccount.count;
  const hash = await hashPassword("a-long-dev-password");
  prisma.developerAccount.findUnique = (async () => ({ email: "dev@vendor.com", name: "Dev", passwordHash: hash })) as unknown as typeof prisma.developerAccount.findUnique;
  prisma.developerSignup.findUnique = (async () => null) as typeof prisma.developerSignup.findUnique;
  prisma.developerSignup.deleteMany = (async () => ({ count: 0 })) as typeof prisma.developerSignup.deleteMany;
  prisma.developerSignup.create = (async () => ({})) as unknown as typeof prisma.developerSignup.create;
  const input = { name: "Dev", password: "a-long-dev-password" };
  try {
    prisma.developerAccount.findUnique = (async () => null) as typeof prisma.developerAccount.findUnique;
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "anyone@example.com", password: "short" }));
    // No developer yet: any email may sign up.
    assert.ok("code" in await startDeveloperSignup({ ...input, email: "anyone@example.com" }));
    // Once one exists, signup closes except for DEVELOPER_EMAIL addresses.
    accounts = 1;
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "admin@client.com" }));
    assert.ok("code" in await startDeveloperSignup({ ...input, email: " SECOND@vendor.com " }));

    prisma.developerAccount.findUnique = (async () => ({ email: "dev@vendor.com", name: "Dev", passwordHash: hash })) as unknown as typeof prisma.developerAccount.findUnique;
    const session = await developerAccountLogin("DEV@vendor.com", "a-long-dev-password");
    assert.equal(session?.role, "developer");
    assert.equal(await developerAccountLogin("dev@vendor.com", "wrong-password"), null);
  } finally {
    process.env.DEVELOPER_EMAIL = env;
    Object.assign(prisma.developerAccount, { findUnique: originals.account, count: originals.count });
    Object.assign(prisma.developerSignup, { findUnique: originals.pending, deleteMany: originals.remove, create: originals.create });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth/password";
import { developerAccountLogin, developerSignupOpen, startDeveloperSignup, verifyDeveloperSignup } from "../lib/server/developer";

test("only one developer account: only configured email can sign up, then signup closes", async () => {
  const envDeveloper = process.env.DEVELOPER_EMAIL;
  const envOwner = process.env.OWNER_EMAIL;
  process.env.DEVELOPER_EMAIL = "anyone@example.com";
  process.env.OWNER_EMAIL = "owner@example.com";
  const originals = {
    settings: prisma.clinicSettings.findFirst,
    user: prisma.user.findFirst,
    account: prisma.developerAccount.findUnique,
    count: prisma.developerAccount.count,
    pending: prisma.developerSignup.findUnique,
    remove: prisma.developerSignup.deleteMany,
    create: prisma.developerSignup.create,
  };
  prisma.clinicSettings.findFirst = (async () => null) as typeof prisma.clinicSettings.findFirst;
  prisma.user.findFirst = (async () => null) as typeof prisma.user.findFirst;
  let accounts = 0;
  const hash = await hashPassword("a-long-dev-password");
  prisma.developerAccount.count = (async () => accounts) as typeof prisma.developerAccount.count;
  prisma.developerAccount.findUnique = (async () => ({ email: "anyone@example.com", name: "Dev", passwordHash: hash })) as unknown as typeof prisma.developerAccount.findUnique;
  prisma.developerSignup.findUnique = (async () => null) as typeof prisma.developerSignup.findUnique;
  prisma.developerSignup.deleteMany = (async () => ({ count: 0 })) as typeof prisma.developerSignup.deleteMany;
  prisma.developerSignup.create = (async () => ({})) as unknown as typeof prisma.developerSignup.create;
  const input = { name: "Dev", password: "a-long-dev-password" };
  try {
    delete process.env.DEVELOPER_EMAIL;
    assert.equal(await developerSignupOpen(), false);
    process.env.DEVELOPER_EMAIL = "anyone@example.com";
    assert.equal(await developerSignupOpen(), true);
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "other@example.com" }));
    assert.ok("error" in await verifyDeveloperSignup("other@example.com", "123456"));
    process.env.OWNER_EMAIL = "anyone@example.com";
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "anyone@example.com" }));
    process.env.OWNER_EMAIL = "owner@example.com";
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "anyone@example.com", password: "short" }));
    assert.ok("code" in await startDeveloperSignup({ ...input, email: "anyone@example.com" }));

    accounts = 1;
    assert.equal(await developerSignupOpen(), false);
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "someone-else@example.com" }));

    const session = await developerAccountLogin("ANYONE@example.com", "a-long-dev-password");
    assert.equal(session?.role, "developer");
    assert.equal(await developerAccountLogin("anyone@example.com", "wrong-password"), null);
  } finally {
    if (envDeveloper === undefined) delete process.env.DEVELOPER_EMAIL; else process.env.DEVELOPER_EMAIL = envDeveloper;
    if (envOwner === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = envOwner;
    prisma.clinicSettings.findFirst = originals.settings;
    prisma.user.findFirst = originals.user;
    Object.assign(prisma.developerAccount, { findUnique: originals.account, count: originals.count });
    Object.assign(prisma.developerSignup, { findUnique: originals.pending, deleteMany: originals.remove, create: originals.create });
  }
});

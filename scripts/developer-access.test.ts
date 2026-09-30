import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth/password";
import { developerAccountLogin, developerSignupOpen, startDeveloperSignup } from "../lib/server/developer";

test("only one developer account: first signup takes any email, then signup closes", async () => {
  const originals = {
    account: prisma.developerAccount.findUnique,
    count: prisma.developerAccount.count,
    pending: prisma.developerSignup.findUnique,
    remove: prisma.developerSignup.deleteMany,
    create: prisma.developerSignup.create,
  };
  let accounts = 0;
  const hash = await hashPassword("a-long-dev-password");
  prisma.developerAccount.count = (async () => accounts) as typeof prisma.developerAccount.count;
  prisma.developerAccount.findUnique = (async () => ({ email: "anyone@example.com", name: "Dev", passwordHash: hash })) as unknown as typeof prisma.developerAccount.findUnique;
  prisma.developerSignup.findUnique = (async () => null) as typeof prisma.developerSignup.findUnique;
  prisma.developerSignup.deleteMany = (async () => ({ count: 0 })) as typeof prisma.developerSignup.deleteMany;
  prisma.developerSignup.create = (async () => ({})) as unknown as typeof prisma.developerSignup.create;
  const input = { name: "Dev", password: "a-long-dev-password" };
  try {
    assert.equal(await developerSignupOpen(), true);
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "anyone@example.com", password: "short" }));
    assert.ok("code" in await startDeveloperSignup({ ...input, email: "anyone@example.com" }));

    accounts = 1;
    assert.equal(await developerSignupOpen(), false);
    assert.ok("error" in await startDeveloperSignup({ ...input, email: "someone-else@example.com" }));

    const session = await developerAccountLogin("ANYONE@example.com", "a-long-dev-password");
    assert.equal(session?.role, "developer");
    assert.equal(await developerAccountLogin("anyone@example.com", "wrong-password"), null);
  } finally {
    Object.assign(prisma.developerAccount, { findUnique: originals.account, count: originals.count });
    Object.assign(prisma.developerSignup, { findUnique: originals.pending, deleteMany: originals.remove, create: originals.create });
  }
});

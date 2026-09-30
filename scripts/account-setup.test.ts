import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { createUser, resetPasswordWithToken } from "../lib/server/clinic-repo";
import { sendAccountSetupEmail } from "../lib/server/mail";
import { verifyPassword } from "../lib/auth/password";

test("staff invitations require email and never expose or use an admin-provided password", async () => {
  const originalSettings = prisma.clinicSettings.findFirst;
  prisma.clinicSettings.findFirst = (async () => null) as typeof prisma.clinicSettings.findFirst;
  const originalDeveloper = prisma.developerAccount.findUnique;
  prisma.developerAccount.findUnique = (async () => null) as typeof prisma.developerAccount.findUnique;
  const original = { findUnique: prisma.user.findUnique, findFirst: prisma.user.findFirst, create: prisma.user.create };
  let storedHash = "";
  prisma.user.findUnique = (async () => null) as typeof prisma.user.findUnique;
  prisma.user.findFirst = (async () => null) as typeof prisma.user.findFirst;
  prisma.user.create = (async ({ data }: { data: { passwordHash: string } }) => {
    storedHash = data.passwordHash;
    return { ...data, id: "user", createdAt: new Date() };
  }) as unknown as typeof prisma.user.create;
  try {
    const input = { username: "STAFF", name: "Staff", role: "nurse" as const, password: "admin-password" };
    assert.ok("error" in await createUser(input));
    assert.ok("error" in await createUser({ ...input, email: "invalid-email" }));
    assert.equal(storedHash, "");
    const result = await createUser({ ...input, email: "Staff@Example.com" });
    assert.ok("user" in result);
    assert.equal(result.user.email, "staff@example.com");
    assert.equal(result.user.username, "staff");
    assert.equal("tempPassword" in result, false);
    assert.equal(await verifyPassword(input.password, storedHash), false);
  } finally {
    prisma.clinicSettings.findFirst = originalSettings;
    prisma.developerAccount.findUnique = originalDeveloper;
    Object.assign(prisma.user, original);
  }
});

test("password links are single-use, reject inactive accounts, and roll back failed writes", async () => {
  let state = {
    reset: { id: "reset", userId: "user", usedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) },
    user: { id: "user", username: "staff", active: true, passwordHash: "old" },
  };
  let failWrite = false;
  let claimLost = false;
  const original = prisma.$transaction;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => {
    const next = structuredClone(state);
    const tx = {
      passwordReset: {
        findUnique: async () => next.reset,
        updateMany: async () => {
          if (claimLost) return { count: 0 };
          next.reset.usedAt = new Date();
          return { count: 1 };
        },
        deleteMany: async () => ({ count: 0 }),
      },
      user: {
        findUnique: async () => next.user,
        update: async ({ data }: { data: { passwordHash: string } }) => {
          if (failWrite) throw new Error("write failed");
          next.user.passwordHash = data.passwordHash;
          return next.user;
        },
      },
    };
    const result = await run(tx);
    state = next;
    return result;
  }) as typeof prisma.$transaction;
  try {
    assert.ok("error" in await resetPasswordWithToken("token", "short"));
    assert.deepEqual(await resetPasswordWithToken("token", "chosen-password"), { username: "staff" });
    assert.ok(await verifyPassword("chosen-password", state.user.passwordHash));
    const savedHash = state.user.passwordHash;
    assert.ok("error" in await resetPasswordWithToken("token", "second-password"));
    assert.equal(state.user.passwordHash, savedHash);
    state.reset.usedAt = null;
    state.user.active = false;
    assert.ok("error" in await resetPasswordWithToken("token", "second-password"));
    assert.equal(state.reset.usedAt, null);
    state.user.active = true;
    state.reset.expiresAt = new Date(0);
    assert.ok("error" in await resetPasswordWithToken("token", "second-password"));
    state.reset.expiresAt = new Date(Date.now() + 60_000);
    claimLost = true;
    assert.ok("error" in await resetPasswordWithToken("token", "second-password"));
    assert.equal(state.user.passwordHash, savedHash);
    claimLost = false;
    failWrite = true;
    await assert.rejects(resetPasswordWithToken("token", "second-password"), /write failed/);
    assert.equal(state.reset.usedAt, null);
    assert.equal(state.user.passwordHash, savedHash);
  } finally {
    prisma.$transaction = original;
  }
});

test("invitation emails contain the setup link and username, escape HTML, and detect SMTP rejection", async () => {
  const original = nodemailer.createTransport;
  let accepted = true;
  let message: { html: string; text: string } | undefined;
  nodemailer.createTransport = (() => ({
    sendMail: async (mail: { html: string; text: string }) => {
      message = mail;
      return { accepted: accepted ? ["staff@example.com"] : [] };
    },
  })) as unknown as typeof nodemailer.createTransport;
  try {
    const opts = { to: "staff@example.com", name: "<img src=x>", username: "staff&one", link: "https://clinic.example/reset-password?mode=setup&token=test" };
    await sendAccountSetupEmail(opts);
    assert.ok(message);
    assert.match(message.html, /&lt;img src=x&gt;/);
    assert.match(message.html, /staff&amp;one/);
    assert.ok(message.text.includes(opts.link));
    assert.match(message.text, /7 days/);
    assert.doesNotMatch(message.text, /Temporary password/);
    accepted = false;
    await assert.rejects(sendAccountSetupEmail(opts), /did not accept/);
  } finally {
    nodemailer.createTransport = original;
  }
});

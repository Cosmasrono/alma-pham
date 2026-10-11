import { prisma } from "@/lib/prisma";

function clean(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

export async function signupEmails(): Promise<{ owner: string | null; admin: string | null }> {
  const settings = await prisma.clinicSettings.findFirst({
    select: { ownerEmail: true, adminSignupEmail: true },
  });
  return { owner: clean(process.env.OWNER_EMAIL) ?? clean(settings?.ownerEmail), admin: clean(settings?.adminSignupEmail) };
}

export async function isOwnerEmail(email: string | null | undefined): Promise<boolean> {
  const target = clean(email);
  if (!target) return false;
  return (await signupEmails()).owner === target;
}

/** May this email sign up as the owner? */
export async function signupAllowed(email: string | null | undefined): Promise<boolean> {
  const target = clean(email);
  if (!target) return false;
  const { owner } = await signupEmails();
  return target === owner && target !== clean(process.env.DEVELOPER_EMAIL);
}

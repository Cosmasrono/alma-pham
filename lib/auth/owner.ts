// The clinic that bought the system names its owner and administrator in
// ClinicSettings (see scripts/configure-signup.ts). Only those two emails can
// sign up; the owner uses the admin role, with additional account deletion
// rights. The software vendor never signs up — it uses the view-only developer
// login from .env instead.
import { prisma } from "@/lib/prisma";

function clean(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

export async function signupEmails(): Promise<{ owner: string | null; admin: string | null }> {
  const settings = await prisma.clinicSettings.findFirst({
    select: { ownerEmail: true, adminSignupEmail: true },
  });
  return { owner: clean(settings?.ownerEmail), admin: clean(settings?.adminSignupEmail) };
}

export async function isOwnerEmail(email: string | null | undefined): Promise<boolean> {
  const target = clean(email);
  if (!target) return false;
  return (await signupEmails()).owner === target;
}

/** May this email sign up (as owner or approved administrator)? */
export async function signupAllowed(email: string | null | undefined): Promise<boolean> {
  const target = clean(email);
  if (!target) return false;
  const { owner, admin } = await signupEmails();
  return target === owner || target === admin;
}

// Shared chrome for the logged-out pages (login, forgot/reset password):
// the team photo with a teal wash, and the frosted card with the brand mark.
import Image from "next/image";
import { BrandLogo } from "./BrandLogo";

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      {/* Background photo with a teal wash so the card stays legible. */}
      <Image
        src="/images/team.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-linear-to-br from-teal-950/85 via-teal-950/70 to-teal-900/60" />
      <div className="relative w-full max-w-sm rounded-3xl border border-white/20 bg-white/95 p-6 shadow-2xl shadow-teal-950/40 backdrop-blur">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandLogo size="lg" />
          <div>
            <p className="font-display text-base font-semibold leading-tight text-teal-950">
              Amla Medicare
            </p>
            <p className="text-xs text-zinc-500">Clinic Management</p>
          </div>
        </div>

        {children}

        <p className="mt-6 text-center text-xs text-zinc-400">
          Staff access only · Amla - Medicare Ltd
        </p>
      </div>
    </div>
  );
}

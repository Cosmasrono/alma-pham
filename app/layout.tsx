import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/components/SessionProvider";
import { SessionLockGate } from "@/components/SessionLockGate";
import { SystemLockGate } from "@/components/SystemLockGate";
import { Toaster } from "@/components/Toaster";
import { getSession } from "@/lib/auth/session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for headlines — the warm, editorial face of the brand.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Amla Medicare — Clinic Management",
  description: "Patient flow from reception to pharmacy",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      // Browser extensions (password managers, writing tools…) add their own
      // attributes to <html> before React loads, which otherwise trips the
      // hydration warning on every page.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider value={session}>
          <AppShell>{children}</AppShell>
          <SessionLockGate />
          <SystemLockGate />
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}

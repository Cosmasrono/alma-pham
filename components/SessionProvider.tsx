"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/roles";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionUser | null;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionUser | null {
  return useContext(SessionContext);
}

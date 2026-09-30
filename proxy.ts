// Route protection. Runs on every request (except static assets). Verifies the
// session cookie and enforces role-based access; redirects appropriately.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/jwt";
import { canAccess, canView, hasPermission, homeForRole } from "@/lib/auth/roles";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public pages: the landing page, the password-reset pages, the unlinked
  // developer access page, plus auth
  // endpoints (login / logout) and the M-Pesa callback, which Safaricom posts
  // to without any session.
  if (
    pathname === "/" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/dev-access" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/mpesa/callback"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const isApi = pathname.startsWith("/api");
  const isLogin = pathname === "/login";

  // Not logged in.
  if (!session) {
    if (isLogin) return NextResponse.next();
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Logged in but on the login page -> send to their home.
  if (isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = homeForRole(session.role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isApi) {
    // The developer account is view-only. One guard for every API: reads
    // pass; the only writes allowed are its own console's on/off switches,
    // switching which branch it is viewing, and asking the AI assistant.
    if (session.role === "developer" && req.method !== "GET" && req.method !== "HEAD") {
      const allowed =
        pathname === "/api/developer" ||
        (pathname === "/api/branches" && req.method === "PUT") ||
        (pathname === "/api/ai" && req.method === "POST");
      if (!allowed) {
        return NextResponse.json(
          { error: "Developer access is view-only — it can't change clinic data." },
          { status: 403 },
        );
      }
      return NextResponse.next();
    }
    if (
      pathname.startsWith("/api/users") &&
      !canView(session.role, "users.manage")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
      pathname.startsWith("/api/mpesa") &&
      !hasPermission(session.role, "mpesa.initiate")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (!canAccess(session.role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = homeForRole(session.role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static image assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

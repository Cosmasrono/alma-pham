// Step 2 of password reset: consume the emailed token, set the new password.
import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/server/clinic-repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();
    const result = await resetPasswordWithToken(
      String(token ?? ""),
      String(password ?? ""),
    );
    if ("error" in result) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true, username: result.username });
  } catch (err) {
    console.error("password reset failed", err);
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}

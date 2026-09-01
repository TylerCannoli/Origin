import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handle, readJson } from "@/lib/api/errors";
import { DEV_AUTH_COOKIE, signDevCookie } from "@/lib/auth/server";
import { env } from "@/lib/env";

/** Development-only sign-in: sets a signed cookie carrying the email. Disabled in production. */
export const POST = handle(async (req) => {
  if (!env.devAuthEnabled || env.supabase) throw badRequest("Dev login is not enabled");
  const { email } = await readJson(req, (d) => z.object({ email: z.string().email() }).parse(d));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_AUTH_COOKIE, signDevCookie(email.toLowerCase()), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});

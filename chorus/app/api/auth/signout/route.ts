import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { DEV_AUTH_COOKIE, createSupabaseServerClient } from "@/lib/auth/server";
import { env } from "@/lib/env";

export const POST = handle(async () => {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/", env.appUrl), { status: 303 });
  res.cookies.set(DEV_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});

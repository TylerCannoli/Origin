import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { UserRow } from "@/lib/db/types";

export const DEV_AUTH_COOKIE = "chorus_dev_user";

/** Signs a dev-auth cookie payload (email) so it cannot be forged without the app secret. */
export function signDevCookie(email: string): string {
  const sig = createHmac("sha256", env.secret).update(email).digest("hex");
  return `${Buffer.from(email).toString("base64url")}.${sig}`;
}

export function verifyDevCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;
  const email = Buffer.from(b64, "base64url").toString("utf8");
  const expected = createHmac("sha256", env.secret).update(email).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}

async function upsertUser(id: string | null, email: string | null, displayName: string | null): Promise<UserRow> {
  const sql = db();
  if (id) {
    const [row] = await sql<UserRow[]>`
      insert into users (id, email, display_name) values (${id}, ${email}, ${displayName})
      on conflict (id) do update set email = coalesce(excluded.email, users.email),
                                     display_name = coalesce(users.display_name, excluded.display_name)
      returning *`;
    return row;
  }
  // Concurrent first requests for a new email (page + API calls) must not race on the insert.
  const [row] = await sql<UserRow[]>`
    insert into users (id, email, display_name) values (gen_random_uuid(), ${email}, ${displayName})
    on conflict (email) do update set display_name = coalesce(users.display_name, excluded.display_name)
    returning *`;
  return row;
}

export async function createSupabaseServerClient() {
  const cfg = env.supabase;
  if (!cfg) return null;
  const cookieStore = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component; middleware refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Resolves the current app user from the Supabase session, or from the dev-auth cookie /
 * header when Supabase is not configured and CHORUS_DEV_AUTH=1. Returns null when anonymous.
 */
export async function getSessionUser(req?: Request): Promise<UserRow | null> {
  // Dev-auth header path first: usable from integration tests without a Next request scope.
  if (!env.supabase && env.devAuthEnabled && req) {
    const headerEmail = req.headers.get("x-chorus-dev-user")?.trim();
    if (headerEmail) return upsertUser(null, headerEmail.toLowerCase(), headerEmail.split("@")[0]);
    const cookieHeader = req.headers.get("cookie") ?? "";
    const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${DEV_AUTH_COOKIE}=`));
    const email = verifyDevCookie(match ? decodeURIComponent(match.slice(DEV_AUTH_COOKIE.length + 1)) : undefined);
    return email ? upsertUser(null, email, email.split("@")[0]) : null;
  }
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return null;
    const name = (u.user_metadata?.display_name as string | undefined) ?? (u.user_metadata?.full_name as string | undefined) ?? null;
    return upsertUser(u.id, u.email ?? null, name);
  }
  if (env.devAuthEnabled) {
    const hdrs = await headers();
    const headerEmail = hdrs.get("x-chorus-dev-user");
    const cookieStore = await cookies();
    const email = headerEmail?.trim() || verifyDevCookie(cookieStore.get(DEV_AUTH_COOKIE)?.value);
    if (!email) return null;
    return upsertUser(null, email, email.split("@")[0]);
  }
  return null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in required");
  }
}

export async function requireUser(req?: Request): Promise<UserRow> {
  const user = await getSessionUser(req);
  if (!user) throw new UnauthorizedError();
  return user;
}

export function authMode(): "supabase" | "dev" | "none" {
  if (env.supabase) return "supabase";
  if (env.devAuthEnabled) return "dev";
  return "none";
}

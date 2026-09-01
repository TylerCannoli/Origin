import postgres, { type Sql } from "postgres";
import { env } from "@/lib/env";

declare global {
  var __chorusSql: Sql | undefined;
}

/** Shared postgres.js client (service role). Reused across hot reloads in dev. */
export function db(): Sql {
  if (!globalThis.__chorusSql) {
    globalThis.__chorusSql = postgres(env.databaseUrl, {
      max: 10,
      idle_timeout: 20,
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return globalThis.__chorusSql;
}

export async function closeDb() {
  if (globalThis.__chorusSql) {
    await globalThis.__chorusSql.end();
    globalThis.__chorusSql = undefined;
  }
}

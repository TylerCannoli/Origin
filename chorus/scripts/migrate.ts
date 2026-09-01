/**
 * Applies supabase/migrations/*.sql in filename order, tracking applied files in
 * schema_migrations. Safe to re-run. Usage: `npm run migrate` (reads DATABASE_URL).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

export async function runMigrations(databaseUrl: string, dir = path.join(process.cwd(), "supabase", "migrations")) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`;
    const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = fs.readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      ran.push(file);
    }
    return ran;
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "No pending migrations");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

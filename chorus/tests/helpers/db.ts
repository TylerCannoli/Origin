import { runMigrations } from "@/scripts/migrate";
import { db, closeDb } from "@/lib/db/client";

export async function migrateTestDb() {
  await runMigrations(process.env.DATABASE_URL!);
}

/** Truncates all app tables between tests. */
export async function resetTestDb() {
  const sql = db();
  await sql.unsafe(
    `truncate table tts_cache, casting_invites, agent_runs, pipeline_runs, rendered_audio, recordings, cues, characters, chapters, manuscripts, projects, users restart identity cascade`,
  );
}

export { db, closeDb };

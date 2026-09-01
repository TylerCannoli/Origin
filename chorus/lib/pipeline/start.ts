import { db } from "@/lib/db/client";
import { createPipelineRun } from "@/lib/db/projects";
import type { Enqueuer } from "@/lib/queue";
import type { PipelineRunRow } from "@/lib/db/types";

/**
 * Enqueues a job for an already-created pipeline_runs row. If the queue is unreachable the run
 * is marked failed (and the project errored) so the UI offers a retry instead of a stuck spinner.
 */
export async function enqueueOrFail(runId: string, projectId: string, enqueue: () => Promise<string>): Promise<void> {
  try {
    await enqueue();
  } catch (err) {
    const message = `Could not queue the job: ${err instanceof Error ? err.message : String(err)}`;
    await db()`update pipeline_runs set status = 'failed', finished_at = now(), error = ${message.slice(0, 2000)} where id = ${runId}`;
    await db()`update projects set status = 'error', updated_at = now() where id = ${projectId}`;
    throw err;
  }
}

/**
 * Resets derived data and kicks off the processing pipeline from the ingest stage.
 * Existing chapters/characters/cues/recordings are removed because a fresh upload
 * invalidates all of them.
 */
export async function startPipeline(projectId: string, enqueuer: Enqueuer, opts: { force?: boolean } = {}): Promise<PipelineRunRow[]> {
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`delete from tts_cache where project_id = ${projectId}`;
    await tx`delete from rendered_audio where project_id = ${projectId}`;
    await tx`delete from chapters where project_id = ${projectId}`; // cascades cues + recordings
    await tx`delete from casting_invites where project_id = ${projectId}`;
    await tx`delete from characters where project_id = ${projectId}`;
    await tx`delete from manuscripts where project_id = ${projectId}`;
    await tx`delete from pipeline_runs where project_id = ${projectId}`;
    await tx`update projects set status = 'processing', updated_at = now() where id = ${projectId}`;
  });
  const run = await createPipelineRun(projectId, "ingest", "queued");
  await enqueueOrFail(run.id, projectId, () => enqueuer.enqueue("ingest", { project_id: projectId, force: opts.force ?? true }));
  return [run];
}

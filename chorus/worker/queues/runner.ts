import type { PipelineStage } from "@/lib/db/types";
import { nextStage, type JobPayload } from "@/lib/queue";
import type { WorkerContext } from "@/worker/context";
import { runIngestion } from "@/worker/agents/ingestion";
import { runCharacterExtraction } from "@/worker/agents/characterExtraction";
import { runDialogueAttribution } from "@/worker/agents/dialogueAttribution";
import { stageHandlers as laterStageHandlers } from "@/worker/queues/stages";

export interface RunOptions {
  /** True when BullMQ will not retry this job again; failures are then recorded as final. */
  finalAttempt: boolean;
}

type Progress = (current: number, total: number, message?: string) => Promise<void>;

/** Runs one pipeline stage with pipeline_runs bookkeeping and next-stage chaining (§4.7, §5.3). */
export async function runStage<S extends PipelineStage>(ctx: WorkerContext, stage: S, payload: JobPayload<S>, opts: RunOptions): Promise<void> {
  const { sql } = ctx;
  const projectId = payload.project_id;
  const chapterId = "chapter_id" in payload ? (payload.chapter_id as string) : null;
  const runId = await claimRun(ctx, stage, projectId, chapterId);
  const progress: Progress = async (current, total, message) => {
    await sql`update pipeline_runs set progress = ${sql.json({ current, total, message: message ?? null, chapter_id: chapterId })} where id = ${runId}`;
  };

  try {
    switch (stage) {
      case "ingest":
        await runIngestion({ sql, llm: ctx.llm, storage: ctx.storage }, payload as JobPayload<"ingest">);
        break;
      case "extract_characters":
        await runCharacterExtraction({ sql, llm: ctx.llm, onProgress: progress }, payload as JobPayload<"extract_characters">);
        break;
      case "attribute_dialogue":
        await runDialogueAttribution({ sql, llm: ctx.llm, onProgress: progress }, payload as JobPayload<"attribute_dialogue">);
        break;
      default: {
        const handler = laterStageHandlers[stage];
        if (!handler) throw new Error(`No handler registered for stage ${stage}`);
        await handler(ctx, payload as never, progress);
      }
    }
    await sql`update pipeline_runs set status = 'complete', finished_at = now(), error = null where id = ${runId}`;
    await chain(ctx, stage, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.finalAttempt) {
      await sql`update pipeline_runs set status = 'failed', finished_at = now(), error = ${message.slice(0, 2000)} where id = ${runId}`;
      await sql`update projects set status = 'error', updated_at = now() where id = ${projectId}`;
    } else {
      await sql`update pipeline_runs set status = 'queued', error = ${`Retrying after: ${message}`.slice(0, 2000)} where id = ${runId}`;
    }
    throw err;
  }
}

/** Finds the queued run for this stage (created by the enqueuer) or creates one, and marks it running. Per-chapter stages are scoped by progress.chapter_id. */
async function claimRun(ctx: WorkerContext, stage: PipelineStage, projectId: string, chapterId: string | null): Promise<string> {
  const { sql } = ctx;
  const [queued] = await sql<{ id: string }[]>`
    select id from pipeline_runs where project_id = ${projectId} and stage = ${stage} and status in ('queued', 'running')
      and (${chapterId}::text is null or progress->>'chapter_id' = ${chapterId})
    order by created_at desc limit 1`;
  if (queued) {
    await sql`update pipeline_runs set status = 'running', started_at = coalesce(started_at, now()), error = null where id = ${queued.id}`;
    return queued.id;
  }
  const [created] = await sql<{ id: string }[]>`
    insert into pipeline_runs (project_id, stage, status, started_at, progress) values (${projectId}, ${stage}, 'running', now(), ${sql.json({ chapter_id: chapterId })}) returning id`;
  return created.id;
}

async function chain<S extends PipelineStage>(ctx: WorkerContext, stage: S, payload: JobPayload<S>) {
  const { sql } = ctx;
  const projectId = payload.project_id;
  const next = nextStage(stage);
  if (next) {
    await sql`insert into pipeline_runs (project_id, stage, status) values (${projectId}, ${next}, 'queued')`;
    await ctx.enqueuer.enqueue(next, { project_id: projectId, force: payload.force });
    return;
  }
  if (stage === "cast_voices") {
    await sql`update projects set status = 'ready', updated_at = now() where id = ${projectId}`;
  }
  if (stage === "render_chapter") {
    const p = payload as JobPayload<"render_chapter">;
    if (!p.then_render_book) return;
    // Wait for every chapter of the batch: the last one to finish enqueues the book render
    // (deterministic job ids collapse duplicate enqueues when two chapters finish together).
    const [{ pending }] = await sql<{ pending: number }[]>`select count(*)::int as pending from chapters where project_id = ${projectId} and status <> 'rendered'`;
    if (pending === 0) {
      const [queued] = await sql<{ id: string }[]>`select id from pipeline_runs where project_id = ${projectId} and stage = 'render_book' and status = 'queued' limit 1`;
      if (!queued) await sql`insert into pipeline_runs (project_id, stage, status) values (${projectId}, 'render_book', 'queued')`;
      await ctx.enqueuer.enqueue("render_book", { project_id: projectId, force: p.force, batch_id: p.batch_id });
    }
  }
}

import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import type { PipelineStage } from "@/lib/db/types";

export const STAGES: PipelineStage[] = [
  "ingest",
  "extract_characters",
  "attribute_dialogue",
  "segment_script",
  "cast_voices",
  "render_chapter",
  "render_book",
];

import { PROCESSING_STAGES } from "@/lib/queue/stages";
export { PROCESSING_STAGES };

export function nextStage(stage: PipelineStage): PipelineStage | null {
  const i = PROCESSING_STAGES.indexOf(stage);
  if (i < 0 || i === PROCESSING_STAGES.length - 1) return null;
  return PROCESSING_STAGES[i + 1];
}

export interface StagePayloads {
  ingest: { project_id: string; force?: boolean };
  extract_characters: { project_id: string; force?: boolean };
  attribute_dialogue: { project_id: string; force?: boolean };
  segment_script: { project_id: string; force?: boolean };
  cast_voices: { project_id: string; force?: boolean };
  render_chapter: { project_id: string; chapter_id: string; force?: boolean; then_render_book?: boolean; batch_id?: string };
  render_book: { project_id: string; force?: boolean; batch_id?: string };
}

export type JobPayload<S extends PipelineStage> = StagePayloads[S];

export interface Enqueuer {
  enqueue<S extends PipelineStage>(stage: S, payload: JobPayload<S>, opts?: JobsOptions): Promise<string>;
}

let connection: IORedis | null = null;
export function redisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return connection;
}

const queues = new Map<PipelineStage, Queue>();
export function queueFor(stage: PipelineStage): Queue {
  let q = queues.get(stage);
  if (!q) {
    q = new Queue(stage, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 500, removeOnFail: 500 },
    });
    queues.set(stage, q);
  }
  return q;
}

/**
 * Deterministic job id per (stage, project, chapter, batch) so duplicate enqueues collapse while
 * a job is pending. BullMQ forbids ":" in custom ids, so parts are joined with "_".
 */
export function jobIdFor<S extends PipelineStage>(stage: S, payload: JobPayload<S>): string {
  const parts = [stage, payload.project_id];
  if ("chapter_id" in payload && payload.chapter_id) parts.push(payload.chapter_id);
  if ("batch_id" in payload && payload.batch_id) parts.push(payload.batch_id);
  return parts.join("_").replace(/:/g, "-");
}

const realEnqueuer: Enqueuer = {
  async enqueue(stage, payload, opts) {
    const job = await queueFor(stage).add(stage, payload, { jobId: jobIdFor(stage, payload), ...opts });
    return job.id ?? jobIdFor(stage, payload);
  },
};

let activeEnqueuer: Enqueuer = realEnqueuer;

/** Enqueuer used by the web app. Delegates so tests can swap in a fake. */
export const bullEnqueuer: Enqueuer = {
  enqueue: (stage, payload, opts) => activeEnqueuer.enqueue(stage, payload, opts),
};

export function __setEnqueuerForTests(e: Enqueuer | null) {
  activeEnqueuer = e ?? realEnqueuer;
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { STAGES, redisConnection, closeQueues } from "@/lib/queue";
import type { PipelineStage } from "@/lib/db/types";
import { createWorkerContext } from "@/worker/context";
import { runStage } from "@/worker/queues/runner";
import { closeDb } from "@/lib/db/client";
import "@/worker/queues/register";

/**
 * Chorus worker process: one BullMQ Worker per pipeline stage. This is the only process that
 * holds the Anthropic / ElevenLabs keys for pipeline work (§5.2).
 */
async function main() {
  const ctx = createWorkerContext();
  const concurrency: Partial<Record<PipelineStage, number>> = { render_chapter: 2, attribute_dialogue: 1 };
  const workers = STAGES.map(
    (stage) =>
      new Worker(
        stage,
        async (job: Job) => {
          const attempts = job.opts.attempts ?? 1;
          const finalAttempt = job.attemptsMade + 1 >= attempts;
          console.log(`[worker] ${stage} start project=${job.data.project_id} attempt=${job.attemptsMade + 1}/${attempts}`);
          await runStage(ctx, stage, job.data, { finalAttempt });
          console.log(`[worker] ${stage} done project=${job.data.project_id}`);
        },
        { connection: redisConnection(), concurrency: concurrency[stage] ?? 1 },
      ),
  );
  for (const w of workers) {
    w.on("failed", (job, err) => console.error(`[worker] ${w.name} failed job=${job?.id}: ${err.message}`));
  }
  console.log(`[worker] listening on ${STAGES.join(", ")}`);

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

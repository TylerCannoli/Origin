import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { STAGES, redisConnection, closeQueues } from "@/lib/queue";
import type { PipelineStage } from "@/lib/db/types";
import { createWorkerContext } from "@/worker/context";
import { runStage } from "@/worker/queues/runner";
import { closeDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import "@/worker/queues/register";

/**
 * Chorus worker process: one BullMQ Worker per pipeline stage. This is the only process that
 * holds the Anthropic / ElevenLabs keys for pipeline work (§5.2).
 */
async function main() {
  if (env.llmProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_PROFILE) {
    console.warn(
      "[worker] CHORUS_LLM_PROVIDER=anthropic but no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set. Model stages will fail unless an `ant auth login` profile exists. Set CHORUS_LLM_PROVIDER=fake for an offline run.",
    );
  }
  if (env.ttsProvider === "elevenlabs" && !env.elevenLabs.apiKey) {
    console.warn("[worker] CHORUS_TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set; renders will fail.");
  }
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

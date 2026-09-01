/** Registers handlers for stages beyond the character pipeline. Imported by the worker entrypoint and tests. */
import { registerStage } from "@/worker/queues/stages";
import { runScriptSegmentation } from "@/worker/agents/scriptSegmentation";
import { runVoiceCasting } from "@/worker/agents/voiceCasting";

registerStage("segment_script", async (ctx, payload, progress) => {
  await runScriptSegmentation({ sql: ctx.sql, llm: ctx.llm, onProgress: progress }, payload);
});

registerStage("cast_voices", async (ctx, payload) => {
  await runVoiceCasting({ sql: ctx.sql, llm: ctx.llm, tts: ctx.tts }, payload);
});

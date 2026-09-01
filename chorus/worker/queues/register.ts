/** Registers handlers for stages beyond the character pipeline. Imported by the worker entrypoint and tests. */
import { registerStage } from "@/worker/queues/stages";
import { runScriptSegmentation } from "@/worker/agents/scriptSegmentation";
import { runVoiceCasting } from "@/worker/agents/voiceCasting";
import { renderBook, renderChapter } from "@/worker/agents/assembly";

registerStage("segment_script", async (ctx, payload, progress) => {
  await runScriptSegmentation({ sql: ctx.sql, llm: ctx.llm, onProgress: progress }, payload);
});

registerStage("cast_voices", async (ctx, payload) => {
  await runVoiceCasting({ sql: ctx.sql, llm: ctx.llm, tts: ctx.tts }, payload);
});

registerStage("render_chapter", async (ctx, payload, progress) => {
  await renderChapter({ sql: ctx.sql, storage: ctx.storage, tts: ctx.tts, ffmpeg: ctx.ffmpeg, onProgress: progress }, payload);
});

registerStage("render_book", async (ctx, payload, progress) => {
  await renderBook({ sql: ctx.sql, storage: ctx.storage, tts: ctx.tts, ffmpeg: ctx.ffmpeg, onProgress: progress }, payload);
});

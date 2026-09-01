import type { Sql } from "postgres";
import { db } from "@/lib/db/client";
import { createLLM } from "@/lib/llm";
import type { LLM } from "@/lib/llm/types";
import { storage, type StorageProvider } from "@/lib/storage";
import { bullEnqueuer, type Enqueuer } from "@/lib/queue";
import { createTTS, type TTSProvider } from "@/lib/tts";
import { FFmpeg } from "@/lib/audio/ffmpeg";

export interface WorkerContext {
  sql: Sql;
  llm: LLM;
  storage: StorageProvider;
  enqueuer: Enqueuer;
  tts: TTSProvider;
  ffmpeg: FFmpeg;
}

export function createWorkerContext(overrides: Partial<WorkerContext> = {}): WorkerContext {
  const sql = overrides.sql ?? db();
  return {
    sql,
    llm: overrides.llm ?? createLLM(sql),
    storage: overrides.storage ?? storage(),
    enqueuer: overrides.enqueuer ?? bullEnqueuer,
    tts: overrides.tts ?? createTTS(),
    ffmpeg: overrides.ffmpeg ?? new FFmpeg(),
  };
}

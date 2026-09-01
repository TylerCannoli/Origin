import type { Sql } from "postgres";
import { db } from "@/lib/db/client";
import { createLLM } from "@/lib/llm";
import type { LLM } from "@/lib/llm/types";
import { storage, type StorageProvider } from "@/lib/storage";
import { bullEnqueuer, type Enqueuer } from "@/lib/queue";

export interface WorkerContext {
  sql: Sql;
  llm: LLM;
  storage: StorageProvider;
  enqueuer: Enqueuer;
}

export function createWorkerContext(overrides: Partial<WorkerContext> = {}): WorkerContext {
  const sql = overrides.sql ?? db();
  return {
    sql,
    llm: overrides.llm ?? createLLM(sql),
    storage: overrides.storage ?? storage(),
    enqueuer: overrides.enqueuer ?? bullEnqueuer,
  };
}

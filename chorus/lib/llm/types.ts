import type { z } from "zod";

export type LLMTier = "strong" | "fast";
export type Effort = "low" | "medium" | "high";

export interface LLMRequest<T> {
  /** Agent/call name, recorded in agent_runs (e.g. "character_extraction.chunk"). */
  agent: string;
  projectId: string | null;
  tier: LLMTier;
  system: string;
  /** Human-readable instruction placed before the JSON input. */
  instruction: string;
  /** Structured payload; serialized as JSON for the model and passed as-is to the fake provider. */
  input: unknown;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: Effort;
}

export interface LLMUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface LLMResult<T> extends LLMUsage {
  data: T;
}

export interface LLM {
  complete<T>(req: LLMRequest<T>): Promise<LLMResult<T>>;
}

export class LLMRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}`);
  }
}

export class LLMParseError extends Error {}

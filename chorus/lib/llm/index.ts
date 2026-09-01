import type { Sql } from "postgres";
import { env } from "@/lib/env";
import { AnthropicLLM } from "@/lib/llm/anthropic";
import { FakeLLM } from "@/lib/llm/fake";
import { LoggedLLM } from "@/lib/llm/logged";
import type { LLM } from "@/lib/llm/types";

/** Builds the configured LLM provider wrapped with retry + agent_runs logging. */
export function createLLM(sql: Sql): LLM {
  const inner: LLM =
    env.llmProvider === "fake"
      ? new FakeLLM()
      : new AnthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, strongModel: env.llmModelStrong, fastModel: env.llmModelFast });
  return new LoggedLLM(inner, sql);
}

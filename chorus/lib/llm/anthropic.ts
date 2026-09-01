import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LLMParseError, LLMRefusalError, type LLM, type LLMRequest, type LLMResult } from "@/lib/llm/types";
import { estimateCostUsd } from "@/lib/llm/pricing";

export interface AnthropicLLMOptions {
  apiKey?: string;
  strongModel: string;
  fastModel: string;
}

/**
 * Claude-backed LLM provider. Every call uses structured outputs so agents receive schema-valid
 * JSON, and (on Opus 5 / Fable tiers) server-side refusal fallbacks so a policy decline on one
 * chunk does not stall the pipeline.
 */
export class AnthropicLLM implements LLM {
  private client: Anthropic;
  constructor(private readonly opts: AnthropicLLMOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  async complete<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    const model = req.tier === "strong" ? this.opts.strongModel : this.opts.fastModel;
    const started = Date.now();
    const useFallbacks = /opus-5|fable/.test(model);
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${req.instruction}\n\n<input>\n${JSON.stringify(req.input)}\n</input>` }],
      output_config: { format: zodOutputFormat(req.schema), ...(req.effort ? { effort: req.effort } : {}) },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const latencyMs = Date.now() - started;
    if (response.stop_reason === "refusal") {
      throw new LLMRefusalError(response.stop_details?.category ?? null);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LLMParseError("Model output was cut off (max_tokens); reduce the batch size");
    }
    const parsed = response.parsed_output;
    if (parsed == null) throw new LLMParseError("Model returned output that did not match the schema");
    const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    const outputTokens = response.usage.output_tokens;
    return {
      data: parsed as T,
      model: response.model,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: estimateCostUsd(response.model, inputTokens, outputTokens),
    };
  }
}

import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { LLMParseError, LLMRefusalError, type LLM, type LLMRequest, type LLMResult } from "@/lib/llm/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps a provider with (a) retry-with-backoff (max 3 attempts) and (b) agent_runs logging of
 * every call: agent name, model, token counts, latency, estimated cost, input hash (§4.7).
 */
export class LoggedLLM implements LLM {
  constructor(
    private readonly inner: LLM,
    private readonly sql: Sql,
    private readonly opts: { maxAttempts?: number; baseDelayMs?: number } = {},
  ) {}

  async complete<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    const maxAttempts = this.opts.maxAttempts ?? 3;
    const inputHash = createHash("sha256").update(JSON.stringify({ s: req.system, i: req.instruction, x: req.input })).digest("hex").slice(0, 32);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const result = await this.inner.complete(req);
        await this.log(req, inputHash, result, null);
        return result;
      } catch (err) {
        lastErr = err;
        await this.log(req, inputHash, { model: "unknown", inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, costUsd: 0 }, err);
        // Refusals will not change on retry; schema mismatches and transient errors occasionally do.
        if (err instanceof LLMRefusalError) break;
        if (attempt < maxAttempts) await sleep((this.opts.baseDelayMs ?? 1500) * 2 ** (attempt - 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new LLMParseError(String(lastErr));
  }

  private async log<T>(req: LLMRequest<T>, inputHash: string, r: Omit<LLMResult<T>, "data">, err: unknown) {
    try {
      await this.sql`insert into agent_runs ${this.sql({
        project_id: req.projectId,
        agent_name: req.agent,
        model: r.model,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        latency_ms: r.latencyMs,
        estimated_cost_usd: r.costUsd,
        input_hash: inputHash,
        status: err ? "error" : "ok",
        error: err ? (err instanceof Error ? err.message : String(err)).slice(0, 2000) : null,
      })}`;
    } catch (logErr) {
      console.error("[llm] failed to log agent run", logErr);
    }
  }
}

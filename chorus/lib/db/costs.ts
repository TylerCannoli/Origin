import { db } from "@/lib/db/client";

export interface AgentCostRow {
  agent_name: string;
  model: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
}

export interface CostReport {
  total_usd: number;
  total_calls: number;
  total_errors: number;
  by_agent: AgentCostRow[];
  activity: { event: string; count: number; last_at: string | null }[];
  tts_cached_clips: number;
}

export async function loadCosts(projectId: string): Promise<CostReport> {
  const sql = db();
  const by_agent = await sql<AgentCostRow[]>`
    select agent_name, model, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors,
      coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens,
      coalesce(sum(estimated_cost_usd), 0)::float as cost_usd, coalesce(avg(latency_ms), 0)::int as avg_latency_ms
    from agent_runs where project_id = ${projectId} group by agent_name, model order by cost_usd desc, calls desc`;
  const activity = await sql<{ event: string; count: number; last_at: string | null }[]>`
    select event, count(*)::int as count, max(created_at) as last_at from analytics_events where project_id = ${projectId} group by event order by last_at desc`;
  const [{ tts }] = await sql<{ tts: number }[]>`select count(*)::int as tts from tts_cache where project_id = ${projectId}`;
  return {
    total_usd: by_agent.reduce((n, r) => n + r.cost_usd, 0),
    total_calls: by_agent.reduce((n, r) => n + r.calls, 0),
    total_errors: by_agent.reduce((n, r) => n + r.errors, 0),
    by_agent,
    activity,
    tts_cached_clips: tts,
  };
}

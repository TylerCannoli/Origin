import { loadCosts } from "@/lib/db/costs";
import { PIPELINE_STEP_LABELS } from "@/lib/agents/types";

const AGENT_LABELS: Record<string, string> = {
  "ingestion.chapter_split": "Chapter split fallback",
  "character_extraction.chunk": "Character extraction (per section)",
  "character_extraction.reconcile": "Character reconciliation",
  "dialogue_attribution.batch": "Dialogue attribution",
  "script_segmentation.delivery_notes": "Delivery notes",
  "voice_casting.rationale": "Voice rationale",
};

const EVENT_LABELS: Record<string, string> = {
  project_created: "Project created",
  manuscript_uploaded: "Manuscript uploaded",
  invite_created: "Casting links created",
  recording_uploaded: "Takes recorded",
  recordings_claimed: "Guest takes claimed",
  render_requested: "Renders requested",
  listen_viewed: "Listen page views",
  character_merged: "Characters merged",
  cue_reassigned: "Lines reassigned",
};

/** Cost dashboard from agent_runs (§4.7) plus basic activity counts. */
export default async function CostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadCosts(id);
  void PIPELINE_STEP_LABELS;
  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Model spend", `$${report.total_usd.toFixed(4)}`],
          ["Model calls", report.total_calls],
          ["Failed calls", report.total_errors],
          ["Cached AI clips", report.tts_cached_clips],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-1 text-3xl display">{value}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-2xl">By agent</h2>
        <p className="mt-1 text-sm text-muted">Estimated from token counts at list prices. Attribution dominates on long books; re-running a stage adds to the total.</p>
        {report.by_agent.length === 0 ? (
          <p className="mt-4 text-muted">No model calls yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal">Agent</th>
                  <th className="px-4 py-2 font-normal">Model</th>
                  <th className="px-4 py-2 text-right font-normal">Calls</th>
                  <th className="px-4 py-2 text-right font-normal">Errors</th>
                  <th className="px-4 py-2 text-right font-normal">Tokens in / out</th>
                  <th className="px-4 py-2 text-right font-normal">Avg latency</th>
                  <th className="px-4 py-2 text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.by_agent.map((r) => (
                  <tr key={`${r.agent_name}-${r.model}`} className="border-t border-line">
                    <td className="px-4 py-2">{AGENT_LABELS[r.agent_name] ?? r.agent_name}</td>
                    <td className="px-4 py-2 text-muted">{r.model}</td>
                    <td className="px-4 py-2 text-right">{r.calls}</td>
                    <td className={`px-4 py-2 text-right ${r.errors ? "text-danger" : ""}`}>{r.errors}</td>
                    <td className="px-4 py-2 text-right">
                      {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">{(r.avg_latency_ms / 1000).toFixed(1)}s</td>
                    <td className="px-4 py-2 text-right">${r.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-2xl">Activity</h2>
        {report.activity.length === 0 ? (
          <p className="mt-2 text-muted">No activity recorded yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-3">
            {report.activity.map((a) => (
              <li key={a.event} className="flex items-baseline justify-between rounded-md border border-line bg-surface px-4 py-2 text-sm">
                <span>{EVENT_LABELS[a.event] ?? a.event}</span>
                <span className="text-xl display">{a.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

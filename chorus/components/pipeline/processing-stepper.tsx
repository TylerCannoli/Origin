"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineRunRow, ProjectStatus } from "@/lib/db/types";
import { PIPELINE_STEP_LABELS } from "@/lib/agents/types";
import { PROCESSING_STAGES } from "@/lib/queue/stages";
import { Wave } from "@/components/ui/wave";

type Status = { status: ProjectStatus; runs: PipelineRunRow[] };

/** Polls pipeline status every 2s while the project is processing and refreshes the page when it finishes. */
export function ProcessingStepper({ projectId, initial }: { projectId: string; initial: Status }) {
  const router = useRouter();
  const [state, setState] = useState<Status>(initial);

  useEffect(() => {
    if (state.status !== "processing") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/pipeline-status`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (cancelled) return;
        setState(data);
        if (data.status !== "processing") router.refresh();
      } catch {
        /* keep polling */
      }
    };
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, state.status, router]);

  const byStage = new Map(state.runs.map((r) => [r.stage, r]));
  return (
    <ol className="grid gap-3 md:grid-cols-5">
      {PROCESSING_STAGES.map((stage, i) => {
        const run = byStage.get(stage);
        const s = run?.status ?? "pending";
        const tone =
          s === "complete" ? "border-moss bg-moss-soft" : s === "running" ? "border-gold bg-gold-soft" : s === "failed" ? "border-danger bg-record-soft" : "border-line bg-surface";
        return (
          <li key={stage} className={`rounded-md border p-3 ${tone}`}>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Step {i + 1}</span>
              {s === "running" ? <Wave bars={5} live className="text-gold" /> : null}
            </div>
            <div className="mt-1 font-medium">{PIPELINE_STEP_LABELS[stage]}</div>
            <div className="mt-1 text-xs text-ink-soft">
              {s === "pending" && "Waiting"}
              {s === "queued" && "Queued"}
              {s === "running" && (run?.progress?.message ?? (run?.progress?.total ? `${run.progress.current ?? 0} of ${run.progress.total}` : "Working"))}
              {s === "complete" && "Done"}
              {s === "failed" && (run?.error ? `Failed: ${run.error}` : "Failed")}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

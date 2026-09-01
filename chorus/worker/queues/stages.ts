import type { PipelineStage } from "@/lib/db/types";
import type { JobPayload } from "@/lib/queue";
import type { WorkerContext } from "@/worker/context";

export type StageHandler<S extends PipelineStage> = (
  ctx: WorkerContext,
  payload: JobPayload<S>,
  progress: (current: number, total: number, message?: string) => Promise<void>,
) => Promise<void>;

/**
 * Handlers for stages implemented after the character pipeline (segmentation, casting,
 * rendering). Registered here so the runner stays a single dispatch point.
 */
export const stageHandlers: { [S in PipelineStage]?: StageHandler<S> } = {};

export function registerStage<S extends PipelineStage>(stage: S, handler: StageHandler<S>) {
  (stageHandlers as Record<string, unknown>)[stage] = handler;
}

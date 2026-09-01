import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { createPipelineRun, getOwnedProject, touchProject } from "@/lib/db/projects";
import { bullEnqueuer } from "@/lib/queue";
import { PROCESSING_STAGES } from "@/lib/queue/stages";
import type { PipelineStage } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Re-enqueues a single processing stage (resumable from the last completed stage per §4.7). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const project = await getOwnedProject(id, user.id);
  const { stage } = await readJson(req, (d) => z.object({ stage: z.enum(PROCESSING_STAGES as [PipelineStage, ...PipelineStage[]]) }).parse(d));
  if (!project.source_file_url) throw badRequest("Upload a manuscript first");
  await touchProject(id, { status: "processing" });
  const run = await createPipelineRun(id, stage, "queued");
  await bullEnqueuer.enqueue(stage, { project_id: id, force: true });
  return json({ run }, { status: 202 });
});

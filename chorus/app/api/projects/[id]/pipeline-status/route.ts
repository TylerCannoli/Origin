import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedProject, latestPipelineRuns } from "@/lib/db/projects";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const project = await getOwnedProject(id, user.id);
  const runs = await latestPipelineRuns(id);
  return json({ status: project.status, runs });
});

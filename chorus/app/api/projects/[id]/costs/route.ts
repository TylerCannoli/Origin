import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedProject } from "@/lib/db/projects";
import { loadCosts } from "@/lib/db/costs";

type Ctx = { params: Promise<{ id: string }> };

/** Per-agent cost/usage breakdown from agent_runs plus recent activity counts. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  return json(await loadCosts(id));
});

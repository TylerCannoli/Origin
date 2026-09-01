import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedProject } from "@/lib/db/projects";
import { listAudio } from "@/lib/db/audio";
import type { PipelineRunRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Rendered chapter + full-book audio with signed URLs, plus in-flight render runs. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  const audio = await listAudio(id);
  const runs = await db()<PipelineRunRow[]>`
    select * from pipeline_runs where project_id = ${id} and stage in ('render_chapter', 'render_book') and created_at > now() - interval '1 day'
    order by created_at desc limit 100`;
  const active = runs.filter((r) => r.status === "queued" || r.status === "running");
  const failed = runs.filter((r) => r.status === "failed" && !active.length);
  return json({ ...audio, rendering: active.length > 0, runs: active, failed: failed.slice(0, 5) });
});

import { handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedProject, latestPipelineRuns, touchProject } from "@/lib/db/projects";
import { updateProjectSchema } from "@/lib/validation/schemas";
import { storage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const project = await getOwnedProject(id, user.id);
  const sql = db();
  const [counts] = await sql<{ characters: number; chapters: number; cues: number; recorded: number; needs_review: number }[]>`
    select
      (select count(*)::int from characters c where c.project_id = ${id} and not c.is_narrator and not c.is_excluded and c.merged_into_id is null) as characters,
      (select count(*)::int from chapters ch where ch.project_id = ${id}) as chapters,
      (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id}) as cues,
      (select count(distinct r.cue_id)::int from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id
         where ch.project_id = ${id} and r.status <> 'rejected') as recorded,
      (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id} and cu.needs_review) as needs_review`;
  const runs = await latestPipelineRuns(id);
  return json({ project, counts, pipeline: runs });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  const body = await readJson(req, (d) => updateProjectSchema.parse(d));
  const project = await touchProject(id, body);
  return json({ project });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  await db()`delete from projects where id = ${id}`;
  await storage().deletePrefix(`projects/${id}`).catch((err) => console.warn("[projects] storage cleanup failed", err));
  return json({ ok: true });
});

import { randomUUID } from "node:crypto";
import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedProject } from "@/lib/db/projects";
import { bullEnqueuer } from "@/lib/queue";
import { renderSchema } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/api/rate-limit";
import type { ChapterRow } from "@/lib/db/types";
import { track } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Enqueues render_chapter jobs for stale chapters (or the requested ones) and a render_book
 * job once they finish. Chapters already rendered are skipped unless force (§4.6 incremental).
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await rateLimit(`render:${user.id}`, 30, 3600);
  const project = await getOwnedProject(id, user.id);
  const body = await readJson(req, (d) => renderSchema.parse(d ?? {})).catch(() => ({ chapter_ids: undefined, force: undefined }));
  const sql = db();
  const chapters = await sql<(ChapterRow & { cue_count: number; has_render: boolean })[]>`
    select ch.*, (select count(*)::int from cues cu where cu.chapter_id = ch.id) as cue_count,
      exists (select 1 from rendered_audio r where r.chapter_id = ch.id and r.scope = 'chapter') as has_render
    from chapters ch where ch.project_id = ${id} order by ch.order_index`;
  if (chapters.length === 0 || chapters.every((c) => c.cue_count === 0)) throw badRequest("The script is not ready yet. Wait for processing to finish before generating audio.");
  if (project.status === "processing") throw badRequest("The project is still processing.");

  const [running] = await sql`select 1 from pipeline_runs where project_id = ${id} and stage in ('render_chapter', 'render_book') and status in ('queued', 'running') limit 1`;
  if (running) throw badRequest("A render is already in progress. Wait for it to finish.");

  const wanted = new Set(body.chapter_ids ?? []);
  const stale = chapters.filter((c) => c.cue_count > 0 && (body.force || wanted.has(c.id) || c.status !== "rendered" || !c.has_render));
  const batchId = randomUUID().slice(0, 8);
  const runs = [];
  if (stale.length === 0) {
    const [run] = await sql`insert into pipeline_runs (project_id, stage, status) values (${id}, 'render_book', 'queued') returning *`;
    runs.push(run);
    await bullEnqueuer.enqueue("render_book", { project_id: id, force: true, batch_id: batchId });
  } else {
    for (const ch of stale) {
      // Reset status so the book render waits for this chapter.
      await sql`update chapters set status = 'segmented' where id = ${ch.id}`;
      const [run] = await sql`insert into pipeline_runs (project_id, stage, status, progress) values (${id}, 'render_chapter', 'queued', ${sql.json({ chapter_id: ch.id, message: ch.title })}) returning *`;
      runs.push(run);
      await bullEnqueuer.enqueue("render_chapter", { project_id: id, chapter_id: ch.id, force: true, then_render_book: true, batch_id: batchId });
    }
  }
  await track("render_requested", { projectId: id, userId: user.id, props: { chapters: stale.length, force: !!body.force } });
  return json({ batch_id: batchId, chapters_queued: stale.length, runs }, { status: 202 });
});

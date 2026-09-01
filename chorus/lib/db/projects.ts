import { db } from "@/lib/db/client";
import type { ProjectRow, PipelineRunRow, PipelineStage, PipelineStatus } from "@/lib/db/types";
import { forbidden, notFound } from "@/lib/api/errors";

export async function listProjectsForOwner(ownerId: string) {
  const sql = db();
  return sql<(ProjectRow & { character_count: number; chapter_count: number; recorded_cues: number; total_cues: number })[]>`
    select p.*,
      (select count(*)::int from characters c where c.project_id = p.id and not c.is_narrator and not c.is_excluded and c.merged_into_id is null) as character_count,
      (select count(*)::int from chapters ch where ch.project_id = p.id) as chapter_count,
      (select count(distinct r.cue_id)::int from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id
         where ch.project_id = p.id and r.status <> 'rejected') as recorded_cues,
      (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = p.id) as total_cues
    from projects p where p.owner_id = ${ownerId} order by p.updated_at desc`;
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const [row] = await db()<ProjectRow[]>`select * from projects where id = ${id}`;
  return row ?? null;
}

/** Loads a project and asserts ownership. */
export async function getOwnedProject(id: string, ownerId: string): Promise<ProjectRow> {
  const project = await getProject(id);
  if (!project) throw notFound("Project");
  if (project.owner_id !== ownerId) throw forbidden();
  return project;
}

export async function touchProject(id: string, patch: Partial<Pick<ProjectRow, "status" | "title" | "visibility" | "pacing" | "source_file_url" | "source_kind" | "rights_attested">> = {}) {
  const sql = db();
  const [row] = await sql<ProjectRow[]>`update projects set ${sql({ ...patch, updated_at: new Date() })} where id = ${id} returning *`;
  return row;
}

export async function latestPipelineRuns(projectId: string): Promise<PipelineRunRow[]> {
  // One row per stage: the most recent run.
  return db()<PipelineRunRow[]>`
    select distinct on (stage) * from pipeline_runs where project_id = ${projectId}
    order by stage, created_at desc`;
}

export async function createPipelineRun(projectId: string, stage: PipelineStage, status: PipelineStatus = "queued") {
  const [row] = await db()<PipelineRunRow[]>`
    insert into pipeline_runs (project_id, stage, status) values (${projectId}, ${stage}, ${status}) returning *`;
  return row;
}

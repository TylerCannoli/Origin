import { getProject } from "@/lib/db/projects";
import { listAudio } from "@/lib/db/audio";
import { db } from "@/lib/db/client";
import { ListenPanel } from "./listen-panel";
import type { PipelineRunRow } from "@/lib/db/types";

export default async function ListenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await getProject(id))!;
  const audio = await listAudio(id);
  const runs = await db()<PipelineRunRow[]>`
    select * from pipeline_runs where project_id = ${id} and stage in ('render_chapter', 'render_book') and status in ('queued', 'running')`;
  const [counts] = await db()<{ cues: number; recorded: number }[]>`
    select (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id}) as cues,
           (select count(distinct r.cue_id)::int from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id} and r.status <> 'rejected') as recorded`;
  return (
    <ListenPanel
      project={{ id: project.id, title: project.title, visibility: project.visibility, pacing: project.pacing, status: project.status }}
      initial={{ ...audio, rendering: runs.length > 0, runs, failed: [] }}
      counts={counts}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}

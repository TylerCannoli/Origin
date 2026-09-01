import Link from "next/link";
import { ProcessingStepper } from "@/components/pipeline/processing-stepper";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getProject, latestPipelineRuns } from "@/lib/db/projects";
import { db } from "@/lib/db/client";
import { ProjectOverviewActions } from "./overview-actions";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await getProject(id))!;
  const runs = await latestPipelineRuns(id);
  const sql = db();
  const [counts] = await sql<{ characters: number; chapters: number; cues: number; recorded: number; needs_review: number; cost: number }[]>`
    select
      (select count(*)::int from characters c where c.project_id = ${id} and not c.is_narrator and not c.is_excluded and c.merged_into_id is null) as characters,
      (select count(*)::int from chapters ch where ch.project_id = ${id}) as chapters,
      (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id}) as cues,
      (select count(distinct r.cue_id)::int from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id
         where ch.project_id = ${id} and r.status <> 'rejected') as recorded,
      (select count(*)::int from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${id} and cu.needs_review) as needs_review,
      (select coalesce(sum(estimated_cost_usd), 0)::float from agent_runs where project_id = ${id}) as cost`;

  const hasSource = !!project.source_file_url;
  const failed = runs.find((r) => r.status === "failed");

  return (
    <div className="space-y-8">
      {!hasSource ? (
        <Notice tone="warn">
          This project has no manuscript yet. <Link href={`/projects/${id}/settings`} className="underline">Upload one</Link> to start.
        </Notice>
      ) : null}

      {hasSource ? (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl">Processing</h2>
            <span className="text-sm text-muted">
              {project.status === "processing" ? "Live updates every few seconds" : project.status === "ready" ? "Complete" : project.status === "error" ? "Stopped" : ""}
            </span>
          </div>
          <div className="mt-4">
            <ProcessingStepper projectId={id} initial={{ status: project.status, runs }} />
          </div>
          {failed ? (
            <div className="mt-4">
              <Notice tone="error">
                {failed.error ?? "A processing step failed."} <ProjectOverviewActions projectId={id} stage={failed.stage} />
              </Notice>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Characters", counts.characters, `/projects/${id}/casting`],
          ["Chapters", counts.chapters, `/projects/${id}/script`],
          ["Lines recorded", `${counts.recorded} / ${counts.cues}`, `/projects/${id}/casting`],
          ["Lines to review", counts.needs_review, `/projects/${id}/review`],
        ].map(([label, value, href]) => (
          <Link key={String(label)} href={String(href)} className="rounded-lg border border-line bg-surface p-4 hover:border-line-strong">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-1 text-3xl display">{value}</div>
          </Link>
        ))}
      </section>

      {project.status === "ready" ? (
        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-2xl">Next steps</h2>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-soft">
            <li>Check the casting board: merge duplicates, rename, or drop minor characters.</li>
            {counts.needs_review > 0 ? <li>Assign a speaker to the {counts.needs_review} lines Chorus was unsure about.</li> : null}
            <li>Invite readers, or record parts yourself.</li>
            <li>Generate the audiobook whenever you like. Unrecorded lines use each character&apos;s AI voice.</li>
          </ol>
          <div className="mt-4 flex gap-3">
            <ButtonLink href={`/projects/${id}/casting`}>Open casting board</ButtonLink>
            <ButtonLink href={`/projects/${id}/listen`} variant="secondary">
              Generate audiobook
            </ButtonLink>
          </div>
        </section>
      ) : null}

      <p className="text-xs text-muted">
        Processing cost so far: ${counts.cost.toFixed(4)} in model usage.{" "}
        <Link href={`/projects/${id}/costs`} className="underline">
          See the breakdown
        </Link>
      </p>
    </div>
  );
}

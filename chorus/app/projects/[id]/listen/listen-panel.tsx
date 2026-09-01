"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AudioListing } from "@/lib/db/audio";
import type { PipelineRunRow, ProjectRow } from "@/lib/db/types";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/field";
import { Wave } from "@/components/ui/wave";
import { ChapterPlayer } from "@/components/player/chapter-player";

type Listing = AudioListing & { rendering: boolean; runs: PipelineRunRow[]; failed: PipelineRunRow[] };

export function ListenPanel({
  project,
  initial,
  counts,
  appUrl,
}: {
  project: Pick<ProjectRow, "id" | "title" | "visibility" | "pacing" | "status">;
  initial: Listing;
  counts: { cues: number; recorded: number };
  appUrl: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Listing>(initial);
  const [pacing, setPacing] = useState(project.pacing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data.rendering) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.get<Listing>(`/api/projects/${project.id}/audio`);
        setData(next);
        if (!next.rendering) router.refresh();
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [data.rendering, project.id, router]);

  async function generate(force = false) {
    setBusy(true);
    setError(null);
    try {
      if (pacing !== project.pacing) await api.patch(`/api/projects/${project.id}`, { pacing });
      await api.post(`/api/projects/${project.id}/render`, { force: force || pacing !== project.pacing });
      const next = await api.get<Listing>(`/api/projects/${project.id}/audio`);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the render");
    } finally {
      setBusy(false);
    }
  }

  const staleCount = data.chapters.filter((c) => c.stale).length;
  const rendered = data.chapters.filter((c) => c.render);
  const shareUrl = `${appUrl}/listen/${project.id}`;
  const running = data.runs.filter((r) => r.status === "running");

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl">Generate the audiobook</h2>
            <p className="mt-1 text-sm text-muted">
              {counts.recorded} of {counts.cues} lines have human takes. The rest are read by each character&apos;s AI voice.
              {staleCount > 0 && rendered.length > 0 ? ` ${staleCount} chapter${staleCount === 1 ? "" : "s"} changed since the last render and will be re-rendered.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted">
              Pacing{" "}
              <Select value={pacing} onChange={(e) => setPacing(e.target.value as ProjectRow["pacing"])} className="inline-block w-auto">
                <option value="tight">Tight</option>
                <option value="normal">Normal</option>
                <option value="relaxed">Relaxed</option>
              </Select>
            </label>
            <Button onClick={() => generate(false)} disabled={busy || data.rendering || project.status !== "ready"}>
              {data.rendering ? "Rendering" : rendered.length > 0 ? "Re-generate" : "Generate audiobook"}
            </Button>
            {rendered.length > 0 && !data.rendering ? (
              <Button variant="ghost" onClick={() => generate(true)} disabled={busy} title="Re-render every chapter">
                Rebuild all
              </Button>
            ) : null}
          </div>
        </div>
        {project.status !== "ready" ? <div className="mt-4"><Notice tone="warn">The script is not ready yet. Generation is available once processing finishes.</Notice></div> : null}
        {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
        {data.rendering ? (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-gold bg-gold-soft px-4 py-3 text-sm">
            <Wave bars={6} live className="text-gold" />
            <span>
              {running[0]?.progress?.message ?? `Rendering ${data.runs.length} job${data.runs.length === 1 ? "" : "s"}`}
              {running[0]?.progress?.total ? ` (${running[0].progress.current ?? 0}/${running[0].progress.total})` : ""}
            </span>
          </div>
        ) : null}
        {data.failed.length > 0 && !data.rendering ? (
          <div className="mt-4">
            <Notice tone="error">The last render failed: {data.failed[0].error ?? "unknown error"}. Fix the issue and generate again.</Notice>
          </div>
        ) : null}
      </section>

      {rendered.length > 0 ? (
        <>
          <ChapterPlayer
            title={project.title}
            chapters={rendered.map((c) => ({ title: c.chapter.title, order_index: c.chapter.order_index, url: c.render!.url, duration_ms: c.render!.duration_ms }))}
          />
          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-5">
              <h3 className="text-xl">Download</h3>
              <p className="mt-1 text-sm text-muted">The full book, or chapters one by one.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.book.mp3 ? (
                  <a className="rounded-md border border-ink bg-ink px-3 py-1.5 text-sm text-surface-strong" href={data.book.mp3.url} download>
                    Full book MP3
                  </a>
                ) : (
                  <span className="text-sm text-muted">{data.rendering ? "Full book is being assembled." : "Generate to build the full-book files."}</span>
                )}
                {data.book.m4b ? (
                  <a className="rounded-md border border-line-strong bg-surface-strong px-3 py-1.5 text-sm" href={data.book.m4b.url} download>
                    Audiobook M4B (with chapters)
                  </a>
                ) : null}
              </div>
              <ul className="mt-4 space-y-1 text-sm">
                {rendered.map((c) => (
                  <li key={c.chapter.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{c.chapter.title ?? `Chapter ${c.chapter.order_index + 1}`}</span>
                    <a href={c.render!.url} download className="shrink-0 text-muted hover:text-ink">
                      MP3{c.stale ? " (outdated)" : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-line bg-surface p-5">
              <h3 className="text-xl">Share</h3>
              {project.visibility === "public_listen" ? (
                <>
                  <p className="mt-1 text-sm text-muted">Anyone with this link can listen. Raw takes are never exposed, only the finished audio.</p>
                  <div className="mt-3 flex gap-2">
                    <input readOnly value={shareUrl} className="w-full rounded-md border border-line-strong bg-surface-strong px-3 py-1.5 text-sm" onFocus={(e) => e.currentTarget.select()} />
                    <Button
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">
                  This project is {project.visibility === "private" ? "private" : "invite only"}. Switch it to a public listen link in{" "}
                  <Link href={`/projects/${project.id}/settings`} className="underline">
                    settings
                  </Link>{" "}
                  to share the finished audiobook.
                </p>
              )}
            </div>
          </section>
        </>
      ) : !data.rendering ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <h3 className="text-xl">Nothing rendered yet</h3>
          <p className="mt-2 text-muted">Generate the audiobook whenever you like. You can re-record any line later and only that chapter is rebuilt.</p>
        </div>
      ) : null}
    </div>
  );
}

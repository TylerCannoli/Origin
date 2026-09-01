import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/db/projects";
import { getSessionUser } from "@/lib/auth/server";
import { listAudio } from "@/lib/db/audio";
import { Wave } from "@/components/ui/wave";
import { ChapterPlayer } from "@/components/player/chapter-player";

export const dynamic = "force-dynamic";

/** Public listen page for projects with visibility = public_listen (owners can always open it). */
export default async function PublicListenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const user = await getSessionUser();
  if (project.visibility !== "public_listen" && user?.id !== project.owner_id) notFound();
  const audio = await listAudio(id, 6 * 3600);
  const chapters = audio.chapters.filter((c) => c.render);
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg display">
            <Wave bars={7} className="text-gold" seed={5} />
            Chorus
          </Link>
          <span className="text-sm text-muted">Made with friends</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-4xl">{project.title}</h1>
        {chapters.length === 0 ? (
          <p className="mt-4 text-ink-soft">This audiobook has not been generated yet. Check back soon.</p>
        ) : (
          <div className="mt-6 space-y-4">
            <ChapterPlayer title={project.title} chapters={chapters.map((c) => ({ title: c.chapter.title, order_index: c.chapter.order_index, url: c.render!.url, duration_ms: c.render!.duration_ms }))} />
            <div className="flex flex-wrap gap-3 text-sm">
              {audio.book.mp3 ? (
                <a href={audio.book.mp3.url} download className="rounded-md border border-line-strong bg-surface-strong px-3 py-1.5">
                  Download MP3
                </a>
              ) : null}
              {audio.book.m4b ? (
                <a href={audio.book.m4b.url} download className="rounded-md border border-line-strong bg-surface-strong px-3 py-1.5">
                  Download M4B
                </a>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

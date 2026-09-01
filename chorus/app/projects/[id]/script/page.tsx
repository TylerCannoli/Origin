import { loadScript } from "@/lib/db/script";
import { EmptyState } from "@/components/ui/notice";
import { ButtonLink } from "@/components/ui/button";

/** Read-only script viewer for reference and QA. */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chapters = await loadScript(id);
  const total = chapters.reduce((n, c) => n + c.cues.length, 0);
  if (total === 0) {
    return <EmptyState title="No script yet" body="The script appears once Chorus has split the manuscript into lines." action={<ButtonLink href={`/projects/${id}`} variant="secondary">Back to overview</ButtonLink>} />;
  }
  return (
    <div className="grid gap-10 md:grid-cols-[14rem_1fr]">
      <nav className="md:sticky md:top-6 md:self-start">
        <div className="text-sm text-muted">Chapters</div>
        <ol className="mt-2 space-y-1 text-sm">
          {chapters.map(({ chapter, cues }) => (
            <li key={chapter.id}>
              <a href={`#${chapter.id}`} className="block truncate hover:underline">
                {chapter.title ?? `Chapter ${chapter.order_index + 1}`}
              </a>
              <span className="text-xs text-muted">{cues.length} cues</span>
            </li>
          ))}
        </ol>
      </nav>
      <article className="max-w-3xl space-y-12">
        {chapters.map(({ chapter, cues }) => (
          <section key={chapter.id} id={chapter.id}>
            <h2 className="text-3xl">{chapter.title ?? `Chapter ${chapter.order_index + 1}`}</h2>
            <ol className="mt-6 space-y-4">
              {cues.map((cue) => (
                <li key={cue.id} className={`grid gap-1 md:grid-cols-[11rem_1fr] ${cue.needs_review ? "rounded-md border border-gold bg-gold-soft/40 p-2" : ""}`}>
                  <div className="text-sm">
                    <span className={cue.is_narrator ? "text-muted" : "font-medium"}>{cue.needs_review ? "Unassigned" : cue.character_name}</span>
                    {cue.delivery_note ? <span className="block text-xs italic text-muted">{cue.delivery_note}</span> : null}
                    {cue.has_recording ? <span className="block text-xs text-moss">recorded</span> : null}
                  </div>
                  <p className={`script-text ${cue.is_narrator ? "text-ink-soft" : ""}`}>{cue.type === "dialogue" ? `“${cue.text}”` : cue.text}</p>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </article>
    </div>
  );
}
